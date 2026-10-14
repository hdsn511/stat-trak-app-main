#!/usr/bin/env node
// SportQuery end-to-end smoke test across all four sports.
//
//   node scripts/sportquery-smoke.mjs [baseUrl]        (default http://localhost:3001)
//
// Each case opens a fresh session, posts one question over the SSE endpoint,
// and checks what the UI depends on: a results event arrived, no query error,
// rows came back (or the case is allowed to decline), and every player row
// carries a team and the expected league. Exit code 1 if any case fails.
//
// This spends LLM tokens per case and is rate-limited per client id, so it
// runs the cases serially. The system prompt is ~5.6k tokens against Groq's
// 8k tokens-per-minute free tier, so cases are spaced (SQ_DELAY_MS, default
// 20s) and a provider 429 is retried once. Point it at a local server (no
// scheduler) rather than production when iterating on the prompt.

const BASE = (process.argv[2] ?? 'http://localhost:3001').replace(/\/$/, '')
const CLIENT_ID = `smoke-${Date.now()}`
const DELAY_MS = Number(process.env.SQ_DELAY_MS ?? 20000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const headers = { 'content-type': 'application/json', 'x-sportquery-client-id': CLIENT_ID }

// expect: 'rows' → must return rows; 'decline' → rows may be empty but a
// narrative must explain; league → every row that has a league must match.
const CASES = [
  { sport: 'NBA', q: 'Top 5 NBA scorers by points per game last season', expect: 'rows', league: 'nba' },
  { sport: 'NBA', q: 'Which NBA teams had the best record last season?', expect: 'rows' },
  { sport: 'MLB', q: 'Who has the most home runs this season in MLB?', expect: 'rows', league: 'mlb' },
  { sport: 'MLB', q: 'Top 5 MLB starting pitchers by strikeouts this season', expect: 'rows', league: 'mlb' },
  { sport: 'MLB', q: "Best MLB hitters by batting average over their last 10 games, minimum 30 at bats", expect: 'rows', league: 'mlb' },
  { sport: 'NFL', q: 'Top 5 NFL quarterbacks by passing yards this season', expect: 'rows', league: 'nfl' },
  { sport: 'NFL', q: 'Who leads the NFL in receiving yards this season?', expect: 'rows', league: 'nfl' },
  { sport: 'NFL', q: 'Which running backs have the most rushing touchdowns this season?', expect: 'rows', league: 'nfl' },
  { sport: 'NHL', q: 'Top 5 NHL goal scorers this season', expect: 'rows', league: 'nhl' },
  { sport: 'NHL', q: 'Which NHL goalies have the best save percentage this season?', expect: 'rows', league: 'nhl' },
  { sport: 'NHL', q: 'Who has the most points in the NHL over their last 10 games?', expect: 'rows', league: 'nhl' },
  { sport: 'ALL', q: 'Show the NFL standings by win percentage', expect: 'rows' },
  { sport: 'ALL', q: 'Which NFL games have the best picks tonight?', expect: 'decline' },
  { sport: 'ALL', q: 'list of US presidents', expect: 'decline' },
]

async function ask(question) {
  // Session creation is a plain DB insert; one retry rides out a transient blip
  // instead of marking a content case failed.
  let sj
  for (let attempt = 0; attempt < 2 && !sj?.success; attempt++) {
    try {
      const s = await fetch(`${BASE}/api/sportquery/session`, { method: 'POST', headers, body: '{}' })
      sj = await s.json()
    } catch (e) {
      sj = { success: false, error: e.message }
    }
    if (!sj.success) await sleep(3000)
  }
  if (!sj.success) throw new Error(`session: ${sj.error}`)
  const sessionId = sj.data.sessionId

  const res = await fetch(`${BASE}/api/sportquery/message`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId, message: question }),
  })
  if (!res.ok) throw new Error(`message HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`)

  const text = await res.text()
  const events = {}
  for (const block of text.split('\n\n')) {
    const ev = /^event: (.+)$/m.exec(block)?.[1]
    const data = /^data: (.+)$/m.exec(block)?.[1]
    if (ev && data) {
      try { events[ev] = JSON.parse(data) } catch { /* ignore */ }
    }
  }
  return events
}

const TEAM_KEYS = ['team', 'team_abbr', 'abbreviation', 'team_abbreviation']
const hasTeam = (r) => TEAM_KEYS.some((k) => r[k] != null && r[k] !== '')
const isPlayerRow = (r) => r.player_id != null || r.playerid != null

const askWithRetry = async (q) => {
  let ev = await ask(q)
  if (ev.error && /rate.?limit|429/i.test(JSON.stringify(ev.error))) {
    await sleep(35000)
    ev = await ask(q)
  }
  return ev
}

let failures = 0
let first = true
for (const c of CASES) {
  if (!first) await sleep(DELAY_MS)
  first = false
  const label = `[${c.sport}] ${c.q}`
  try {
    const ev = await askWithRetry(c.q)
    const problems = []
    const results = ev.results
    const rows = results?.rows ?? []
    if (ev.error) problems.push(`error event: ${ev.error.error}`)
    if (!ev.narrative?.token && !ev.narrative) problems.push('no narrative')
    if (!results) problems.push('no results event')
    if (results?.query_error) problems.push(`query_error: ${results.query_error}`)
    if (c.expect === 'rows' && rows.length === 0) problems.push('no rows')
    const players = rows.filter(isPlayerRow)
    const noTeam = players.filter((r) => !hasTeam(r)).length
    if (noTeam > 0) problems.push(`${noTeam}/${players.length} player rows have no team`)
    if (c.league) {
      const wrong = rows.filter((r) => r.league && r.league !== c.league).length
      if (wrong > 0) problems.push(`${wrong} rows from another league`)
    }
    const ok = problems.length === 0
    if (!ok) failures++
    const cols = rows[0] ? Object.keys(rows[0]).slice(0, 6).join(',') : '-'
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}\n       rows=${rows.length} shape=${results?.shape ?? '-'} cols=${cols}`)
    for (const p of problems) console.log(`       ! ${p}`)
  } catch (e) {
    failures++
    console.log(`FAIL ${label}\n       ! ${e.message}`)
  }
}
console.log(`\n${CASES.length - failures}/${CASES.length} passed`)
process.exit(failures ? 1 : 0)
