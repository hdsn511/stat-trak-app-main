import { Link } from 'react-router-dom'
import { gamePath } from '@/lib/paths'
import LeaguePill from './LeaguePill'

export type TickerGame = {
  id: string
  /** Database game id. Null when the slate row has no matching DB game. */
  dbId?: number | null
  /** League slug, for routing. */
  slug?: string
  league?: string
  /** Slate date; may not be today when the server fell back to the next one. */
  date?: string | null
  away: string
  home: string
  awayScore?: number
  homeScore?: number
  status: string
  live?: boolean
}

interface LiveTickerProps {
  label: string
  games: TickerGame[]
  /** Shown in place of the games when the slate is empty. */
  emptyLabel?: string
  /** Overrides the default link-to-game behaviour (SportQuery uses this). */
  onGameClick?: (g: TickerGame) => void
}

const WRAPPER =
  'flex items-center gap-[10px] px-[28px] py-[9px] border-b border-[#221E1B] overflow-x-auto no-scrollbar shrink-0'
const STRIPES =
  'repeating-linear-gradient(90deg, transparent 0, transparent 7px, rgba(255,107,61,0.03) 7px, rgba(255,107,61,0.03) 8px)'
const CHIP =
  'flex items-center gap-2 bg-[#1B1715] border border-[#2C2624] hover:border-[#FF6B3D] rounded px-[10px] py-[5px] cursor-pointer whitespace-nowrap shrink-0'

const TODAY = () => new Date().toISOString().slice(0, 10)

/** "NOV 8" — short enough to sit inside a ticker chip. */
function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
}

function ChipBody({ g }: { g: TickerGame }) {
  // Leagues are rarely on the same slate, so a chip from another day says so.
  const offDay = g.date && g.date !== TODAY()
  return (
    <>
      {g.league && <LeaguePill league={g.league} />}
      {offDay && (
        <span className="font-martian text-[8px] text-[#584F4C] tracking-[0.5px]">
          {shortDate(g.date!)}
        </span>
      )}
      {g.live && <span className="w-[6px] h-[6px] rounded-full bg-[#FF6B3D] shrink-0" />}
      <span className="font-martian font-bold text-[11px] text-[#EFEBE9]">{g.away}</span>
      {g.awayScore !== undefined && (
        <span className="font-martian font-bold text-[11px] text-[#EFEBE9]">{g.awayScore}</span>
      )}
      <span className="font-martian text-[9px] text-[#665F5D]">@</span>
      <span className="font-martian font-bold text-[11px] text-[#EFEBE9]">{g.home}</span>
      {g.homeScore !== undefined && (
        <span className="font-martian font-bold text-[11px] text-[#EFEBE9]">{g.homeScore}</span>
      )}
      <span
        className={`font-martian font-medium text-[9px] ${g.live ? 'text-[#FF6B3D]' : 'text-[#665F5D]'}`}
      >
        {g.status}
      </span>
    </>
  )
}

export default function LiveTicker({ label, games, emptyLabel, onGameClick }: LiveTickerProps) {
  return (
    <div className={WRAPPER} style={{ backgroundImage: STRIPES }}>
      <span className="font-martian font-medium text-[9px] text-[#665F5D] tracking-[1.5px] shrink-0">
        {label}
      </span>

      {games.length === 0 && emptyLabel && (
        <span className="font-martian text-[9px] text-[#443E3B] tracking-[1.5px] shrink-0">
          {emptyLabel}
        </span>
      )}

      {games.map((g) =>
        // A game without a database id can't be opened, and an explicit
        // handler takes precedence over navigation.
        !onGameClick && g.dbId && g.slug ? (
          <Link key={g.id} to={gamePath(g.slug, g.dbId)} className={CHIP}>
            <ChipBody g={g} />
          </Link>
        ) : (
          <button key={g.id} type="button" onClick={() => onGameClick?.(g)} className={CHIP}>
            <ChipBody g={g} />
          </button>
        )
      )}
    </div>
  )
}
