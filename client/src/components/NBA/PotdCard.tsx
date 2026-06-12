import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nbaApi, PotdResponse, LeagueApi } from '@/services/api'

// Human labels for condition-breakdown keys across leagues (NBA + MLB).
const CONDITION_LABELS: Record<string, string> = {
  usg_pct: 'Usage', pace: 'Pace', home_away: 'Home / Away', matchup_rank: 'Matchup', rest: 'Rest',
  opportunity: 'Opportunity', handedness: 'Handedness',
}

function renderBullet(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|[^*]+)/g
  let match: RegExpExecArray | null
  let key = 0
  while ((match = re.exec(text)) !== null) {
    const chunk = match[0]
    if (chunk.startsWith('**')) {
      parts.push(
        <strong key={key++} className="text-mint font-bold not-italic">
          {chunk.slice(2, -2)}
        </strong>
      )
    } else if (chunk.startsWith('*')) {
      parts.push(
        <em key={key++} className="not-italic text-gray-500">
          {chunk.slice(1, -1)}
        </em>
      )
    } else {
      parts.push(<span key={key++}>{chunk}</span>)
    }
  }
  return parts
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function PotdCard({ api = nbaApi }: { api?: LeagueApi }) {
  const navigate = useNavigate()
  const [potd, setPotd] = useState<PotdResponse | null | undefined>(undefined)

  useEffect(() => {
    api.getPotd()
      .then(setPotd)
      .catch(() => setPotd(null))
  }, [api])

  if (potd === undefined) {
    return (
      <div className="rounded-2xl border border-[#1a1a1a] bg-[#0D0D0D] p-6 animate-pulse">
        <div className="h-3 w-32 bg-[#1a1a1a] rounded mb-4" />
        <div className="h-7 w-48 bg-[#1a1a1a] rounded mb-2" />
        <div className="h-3 w-36 bg-[#1a1a1a] rounded mb-4" />
        <div className="space-y-2">
          <div className="h-3 w-full bg-[#1a1a1a] rounded" />
          <div className="h-3 w-5/6 bg-[#1a1a1a] rounded" />
          <div className="h-3 w-4/6 bg-[#1a1a1a] rounded" />
        </div>
      </div>
    )
  }

  if (potd === null) {
    return (
      <div className="rounded-2xl border border-[#161616] bg-[#0D0D0D] p-6 flex items-center justify-center min-h-[120px]">
        <p className="text-[11px] font-bold text-gray-700 uppercase tracking-[0.18em] font-condensed">
          Analyzing today&apos;s slate…
        </p>
      </div>
    )
  }

  const hitPct = Math.round((potd.hit_rate ?? 0) * 100)
  const mktPct = Math.round((potd.implied_prob ?? 0) * 100)
  const edgePct = Math.round((potd.edge ?? 0) * 100)
  const directionLabel = potd.direction === 'over' ? '↑ OVER' : '↓ UNDER'

  const metaParts: string[] = []
  if (potd.team) metaParts.push(potd.team)
  if (potd.position) metaParts.push(potd.position)
  if (potd.opponent?.team) metaParts.push(`vs ${potd.opponent.team}`)

  // Derive condition dots from the breakdown keys so it works for any league
  // (NBA usage/pace/… or MLB opportunity/handedness/home_away).
  const cond = (potd.condition_breakdown ?? {}) as Record<string, string>
  const conditions: { label: string; active: boolean }[] = Object.entries(cond).map(
    ([key, val]) => ({
      label: CONDITION_LABELS[key] ?? key.replace(/_/g, ' '),
      active: typeof val === 'string' && val.startsWith('active'),
    })
  )

  const isClickable = potd.prop_type === 'player' && potd.player_id != null

  return (
    <div
      className={[
        'relative overflow-hidden rounded-2xl border border-mint/20',
        'flex items-stretch transition-colors duration-200',
        isClickable ? 'cursor-pointer hover:border-mint/40' : '',
      ].join(' ')}
      style={{
        background: 'linear-gradient(135deg, #1a0e08 0%, #0a0a0a 55%, #0a0a14 100%)',
      }}
      onClick={() => {
        if (isClickable) navigate(`/player/${potd.player_id}`)
      }}
    >
      {/* Radial glow — right side */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 50% 100% at 92% 50%, rgba(255,95,46,0.09) 0%, transparent 70%)',
        }}
      />

      {/* ── Left ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col p-5 pr-7">
        {/* Label row */}
        <div className="flex items-center gap-1.5 mb-2">
          <span className="w-[5px] h-[5px] rounded-full bg-mint flex-shrink-0 animate-pulse-live" />
          <span className="text-[10px] font-bold text-mint uppercase tracking-[0.18em] font-condensed">
            Pick of the Day
          </span>
          <span className="text-[10px] text-[#333] font-medium">
            · {formatDate(potd.game_date)}
          </span>
        </div>

        {/* Player name */}
        <p className="text-[28px] font-black text-white leading-none mb-1 truncate font-condensed">
          {potd.player_name ?? 'Unknown'}
        </p>

        {/* Meta */}
        <p className="text-[11px] text-[#444] mb-3.5">
          {metaParts.join(' · ')}
        </p>

        {/* Line badge */}
        <div className="inline-flex items-center gap-1.5 border border-mint/30 rounded px-2.5 py-1 self-start mb-4">
          <span className="text-[11px] font-black text-mint tracking-[0.06em]">
            {directionLabel} {potd.line} {potd.stat_label}
          </span>
        </div>

        {/* Bullets */}
        <div className="flex flex-col gap-1.5">
          {potd.bullets.map((b, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <span className="text-mint font-black text-[11px] flex-shrink-0">—</span>
              <span className="text-[11.5px] text-[#505050] leading-[1.45]">
                {renderBullet(b)}
              </span>
            </div>
          ))}
        </div>

        {/* Edge bar */}
        <div className="mt-4">
          <div className="flex justify-between mb-1">
            <span className="text-[9px] text-[#444] font-semibold font-mono">
              MKT {mktPct}%
            </span>
            <span className="text-[9px] text-mint font-semibold font-mono">
              HIT {hitPct}% &nbsp;+{edgePct}%
            </span>
          </div>
          <div className="relative h-[3px] bg-[#181818] rounded overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-white/[0.07]"
              style={{ width: `${mktPct}%` }}
            />
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${hitPct}%`,
                background: 'linear-gradient(90deg, rgba(255,95,46,0.45), #FF5F2E)',
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <div className="w-px bg-[#1c1c1c] self-stretch my-1 flex-shrink-0" />

      {/* ── Right ────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex flex-col items-center justify-center px-6 min-w-[140px]">
        <span
          className="font-display font-black text-mint leading-none"
          style={{
            fontSize: '80px',
            letterSpacing: '-2px',
            textShadow: '0 0 36px rgba(255,95,46,0.3)',
          }}
        >
          {Math.round(potd.confidence ?? 0)}
        </span>
        <span className="text-[9px] text-[#444] tracking-[0.2em] uppercase font-bold mt-1 mb-4 font-condensed">
          Confidence
        </span>

        <div className="flex flex-col gap-1 w-full">
          {conditions.map((c) => (
            <div key={c.label} className="flex items-center gap-1.5">
              <span
                className="w-1 h-1 rounded-full flex-shrink-0"
                style={{ background: c.active ? '#FF5F2E' : '#282828' }}
              />
              <span
                className="text-[9px] font-bold uppercase tracking-[0.1em]"
                style={{ color: c.active ? '#FF5F2E' : '#282828' }}
              >
                {c.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Arrow */}
      {isClickable && (
        <span
          className="absolute right-[18px] top-1/2 -translate-y-1/2 text-[#252525] text-base"
          aria-hidden
        >
          ›
        </span>
      )}
    </div>
  )
}
