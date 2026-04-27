# Frontend H — Team View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Plans G (typography) and F (game view) must be complete. TeamView links back to GameView for each game log row.
>
> **Tooling:** Use `frontend-design` skill for UI decisions. Use Playwright MCP to verify. Use context7 for library docs.

**Goal:** Build `/team/:id` with game log (last 20 games), team splits (home/away, last 10), and roster. Entry from PlayerDetailView team label and GameView team name.

**Architecture:** New `TeamView` component. New backend `teamController.ts`. Team data derived from existing `games` + `nba_player_stats` + `players` tables. No new DB schema.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, React Router, Supabase

---

### File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `server/src/controllers/teamController.ts` | `/api/nba/teams/:id` endpoint |
| Modify | `server/src/server.ts` | Register team route |
| Modify | `client/src/services/api.ts` | Add `getTeam(id)` + types |
| Create | `client/src/components/TeamView/TeamView.tsx` | Main team page |
| Modify | `client/src/App.tsx` | Add `/team/:id` route |
| Modify | `client/src/components/TrendFinder/PlayerDetailView.tsx` | Team label links to /team/:id |
| Modify | `client/src/components/GameView/GameView.tsx` | Team names link to /team/:id |

---

### Task 1: Backend — team detail API

**Files:**
- Create: `server/src/controllers/teamController.ts`
- Modify: `server/src/server.ts`

- [ ] **Step 1: Verify data coverage**

  Run via Supabase MCP `execute_sql`:
  ```sql
  -- Check recent game history for a team
  SELECT t.abbreviation, t.name, COUNT(g.id) as games
  FROM teams t
  JOIN games g ON g.home_team_id = t.id OR g.away_team_id = t.id
  WHERE g.league_id = 1
  GROUP BY t.id, t.abbreviation, t.name
  ORDER BY games DESC LIMIT 10;
  ```
  Confirm game history is sufficient for last-20-games log.

- [ ] **Step 2: Create teamController.ts**

  ```typescript
  // server/src/controllers/teamController.ts
  import { supabaseAdmin } from '../config/supabaseAdmin';

  export async function getTeamById(req: any, res: any) {
    try {
      const teamId = parseInt(req.params.id, 10);
      if (isNaN(teamId)) {
        return res.status(400).json({ success: false, error: 'Invalid team ID' });
      }

      // Fetch team info
      const { data: team, error: teamErr } = await supabaseAdmin
        .from('teams')
        .select('id, abbreviation, name')
        .eq('id', teamId)
        .single();

      if (teamErr || !team) {
        return res.status(404).json({ success: false, error: 'Team not found' });
      }

      // Fetch last 20 games
      const { data: games } = await supabaseAdmin
        .from('games')
        .select(`
          id, game_date,
          home_team:teams!games_home_team_id_fkey(id, abbreviation, name),
          away_team:teams!games_away_team_id_fkey(id, abbreviation, name)
        `)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .eq('league_id', 1)
        .order('game_date', { ascending: false })
        .limit(20);

      // For completed games, get team's aggregate stats (to determine W/L)
      const completedGameIds = (games ?? [])
        .filter((g: any) => g.game_date < new Date().toISOString().slice(0, 10))
        .map((g: any) => g.id);

      // Fetch roster (players on this team)
      const { data: roster } = await supabaseAdmin
        .from('players')
        .select('id, name, position')
        .eq('team', team.abbreviation)
        .order('name');

      // Compute basic splits from nba_player_stats
      const today = new Date().toISOString().slice(0, 10);
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 14);
      const tenDaysAgoStr = tenDaysAgo.toISOString().slice(0, 10);

      const { data: recentStats } = await supabaseAdmin
        .from('nba_player_stats')
        .select('game_date, points, rebounds, assists')
        .eq('team_id', teamId)
        .gte('game_date', tenDaysAgoStr)
        .lt('game_date', today);

      const avgPoints = recentStats && recentStats.length > 0
        ? recentStats.reduce((s: number, r: any) => s + (r.points ?? 0), 0) / recentStats.length
        : null;

      res.json({
        success: true,
        data: {
          team: { id: team.id, abbreviation: team.abbreviation, name: team.name },
          games: (games ?? []).map((g: any) => ({
            id: g.id,
            game_date: g.game_date,
            home_team: g.home_team,
            away_team: g.away_team,
            is_home: g.home_team?.id === teamId,
          })),
          roster: roster ?? [],
          recent_avg_points: avgPoints,
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
  ```

- [ ] **Step 3: Register route in server.ts**

  ```typescript
  import { getTeamById } from './controllers/teamController';
  // ...
  app.get('/api/nba/teams/:id', getTeamById);
  ```

- [ ] **Step 4: Add getTeam to api.ts**

  ```typescript
  export interface TeamDetail {
    team: { id: number; abbreviation: string; name: string }
    games: Array<{
      id: number
      game_date: string
      home_team: { id: number; abbreviation: string; name: string }
      away_team: { id: number; abbreviation: string; name: string }
      is_home: boolean
    }>
    roster: Array<{ id: number; name: string; position: string }>
    recent_avg_points: number | null
  }

  // In nbaApi:
  getTeam: (id: number): Promise<TeamDetail> =>
    get(`${BASE}/nba/teams/${id}`),
  ```

- [ ] **Step 5: Build and test**

  ```bash
  cd server && npm run build 2>&1 | tail -10 && npx vitest run 2>&1 | tail -5
  cd ../client && npm run build 2>&1 | tail -5
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add server/src/controllers/teamController.ts server/src/server.ts client/src/services/api.ts
  git commit -m "feat(team-view): add /api/nba/teams/:id endpoint and TeamDetail type"
  ```

---

### Task 2: Build TeamView component and route

**Files:**
- Create: `client/src/components/TeamView/TeamView.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create TeamView component**

  ```tsx
  // client/src/components/TeamView/TeamView.tsx
  import { useEffect, useState } from 'react'
  import { useParams, useNavigate } from 'react-router-dom'
  import { ArrowLeft } from 'lucide-react'
  import { nbaApi, TeamDetail } from '@/services/api'
  import { Skeleton } from '@/components/ui/skeleton'
  import { cn } from '@/lib/utils'

  export default function TeamView() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const [data, setData] = useState<TeamDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const today = new Date().toISOString().slice(0, 10)

    useEffect(() => {
      if (!id) return
      nbaApi.getTeam(parseInt(id))
        .then(setData)
        .catch(() => {})
        .finally(() => setLoading(false))
    }, [id])

    if (loading) {
      return (
        <div className="p-6 space-y-4 max-w-5xl mx-auto">
          <Skeleton className="h-8 w-48 bg-[#0F0F0F]" />
          <Skeleton className="h-24 w-full bg-[#0F0F0F]" />
          <Skeleton className="h-64 w-full bg-[#0F0F0F]" />
        </div>
      )
    }

    if (!data) return <div className="p-6 text-gray-600 font-condensed">Team not found</div>

    const completedGames = data.games.filter(g => g.game_date < today)
    const upcomingGames  = data.games.filter(g => g.game_date >= today)
    const homeGames      = completedGames.filter(g => g.is_home)
    const awayGames      = completedGames.filter(g => !g.is_home)

    return (
      <div className="p-6 max-w-5xl mx-auto space-y-5">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-white transition-colors font-condensed tracking-wide uppercase"
        >
          <ArrowLeft size={12} /> Back
        </button>

        {/* Team header */}
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5 flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-[#141414] border border-[#222] flex items-center justify-center text-xl font-black text-mint font-condensed flex-shrink-0">
            {data.team.abbreviation}
          </div>
          <div>
            <h1 className="text-[28px] font-bold text-white font-condensed leading-none">{data.team.name}</h1>
            <p className="text-[11px] text-gray-600 mt-1 font-condensed">
              {completedGames.length} games played · {homeGames.length} home · {awayGames.length} away
            </p>
          </div>
        </div>

        {/* Game log */}
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#111]">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Game Log</span>
          </div>
          {/* Upcoming */}
          {upcomingGames.slice(0, 3).map(game => {
            const opp = game.is_home ? game.away_team : game.home_team
            return (
              <div
                key={game.id}
                onClick={() => navigate(`/game/${game.id}`)}
                className="flex items-center justify-between px-4 py-3 border-b border-[#0F0F0F] cursor-pointer hover:bg-white/[0.02] transition-colors"
              >
                <div className="text-[12px] font-condensed text-gray-400">
                  {game.is_home ? 'vs' : '@'} <span className="text-white font-semibold">{opp.abbreviation}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-gray-600">{game.game_date}</span>
                  <span className="text-[9px] font-bold text-mint font-condensed uppercase tracking-widest px-1.5 py-0.5 border border-mint/25 rounded">Upcoming</span>
                </div>
              </div>
            )
          })}
          {/* Completed */}
          {completedGames.map(game => {
            const opp = game.is_home ? game.away_team : game.home_team
            return (
              <div
                key={game.id}
                onClick={() => navigate(`/game/${game.id}`)}
                className="flex items-center justify-between px-4 py-3 border-b border-[#0F0F0F] last:border-0 cursor-pointer hover:bg-white/[0.02] transition-colors"
              >
                <div className="text-[12px] font-condensed text-gray-400">
                  {game.is_home ? 'vs' : '@'} <span className="text-white font-semibold">{opp.abbreviation}</span>
                </div>
                <span className="text-[10px] font-mono text-gray-600">{game.game_date}</span>
              </div>
            )
          })}
        </div>

        {/* Roster */}
        {data.roster.length > 0 && (
          <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#111]">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Roster</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3">
              {data.roster.map(player => (
                <div
                  key={player.id}
                  onClick={() => navigate(`/player/${player.id}`)}
                  className="flex items-center justify-between px-4 py-2.5 border-b border-r border-[#0F0F0F] cursor-pointer hover:bg-white/[0.02] transition-colors"
                >
                  <span className="text-[12px] font-semibold text-white font-condensed truncate">{player.name}</span>
                  <span className="text-[10px] text-gray-600 font-condensed flex-shrink-0 ml-2">{player.position}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 2: Add /team/:id route to App.tsx**

  ```tsx
  import TeamView from '@/components/TeamView/TeamView'
  // ...
  <Route path="/team/:id" element={<TeamView />} />
  ```

- [ ] **Step 3: Build check**

  ```bash
  cd client && npm run build 2>&1 | tail -10
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add client/src/components/TeamView/TeamView.tsx client/src/App.tsx
  git commit -m "feat(team-view): add /team/:id route and TeamView component"
  ```

---

### Task 3: Wire team labels in PlayerDetailView and GameView

**Files:**
- Modify: `client/src/components/TrendFinder/PlayerDetailView.tsx`
- Modify: `client/src/components/GameView/GameView.tsx`

- [ ] **Step 1: PlayerDetailView — make team label a link**

  Find the team label in `PlayerDetailView.tsx` (~line 107):
  ```tsx
  <p className="text-[12px] text-gray-600 mt-1 font-condensed tracking-wide">
    {profile.player.team} · {profile.player.position}
  </p>
  ```

  To link to the team, we need the team's DB `id`. Add a `teamId` field to `PlayerProfile`. In `nbaController.ts` `getPlayerGames`, join `teams` on `players.team = teams.abbreviation` and include `team_id` in the response. Then:
  ```tsx
  <p className="text-[12px] text-gray-600 mt-1 font-condensed tracking-wide">
    {profile.teamId
      ? <button onClick={() => navigate(`/team/${profile.teamId}`)} className="hover:text-white transition-colors">{profile.player.team}</button>
      : profile.player.team
    }
    {' · '}{profile.player.position}
  </p>
  ```

- [ ] **Step 2: GameView — make team names links**

  In `GameView.tsx` game header, update team name elements:
  ```tsx
  // Replace static team name divs with navigable buttons
  <button onClick={() => navigate(`/team/${data.game.away_team.id}`)} className="text-center flex-1 hover:opacity-80 transition-opacity">
    <div className="text-[22px] font-bold text-white font-condensed">{data.game.away_team.abbreviation}</div>
    <div className="text-[11px] text-gray-600 font-condensed">{data.game.away_team.name}</div>
  </button>
  // ... and same for home_team
  ```

- [ ] **Step 3: Build, lint, full test**

  ```bash
  cd server && npx vitest run 2>&1 | tail -5
  cd ../client && npm run build && npm run lint 2>&1 | tail -10
  ```

- [ ] **Step 4: Playwright — end-to-end navigation**

  1. Player page → click team label → TeamView
  2. TeamView → click a game → GameView
  3. GameView → click team name → TeamView
  4. TeamView → click a roster player → PlayerDetailView

- [ ] **Step 5: Final commit**

  ```bash
  git add client/src/ server/src/
  git commit -m "feat(team-view): wire team labels in PlayerDetailView and GameView to /team/:id"
  ```
