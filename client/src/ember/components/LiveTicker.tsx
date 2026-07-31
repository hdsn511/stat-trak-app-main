import LeaguePill from './LeaguePill'

export type TickerGame = {
  id: string
  league?: 'NBA' | 'MLB' | 'NFL' | 'NHL'
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
  onGameClick?: (g: TickerGame) => void
}

export default function LiveTicker({ label, games, onGameClick }: LiveTickerProps) {
  return (
    <div
      className="flex items-center gap-[10px] px-[28px] py-[9px] border-b border-[#221E1B] overflow-x-auto no-scrollbar shrink-0"
      style={{
        backgroundImage:
          'repeating-linear-gradient(90deg, transparent 0, transparent 7px, rgba(255,107,61,0.03) 7px, rgba(255,107,61,0.03) 8px)',
      }}
    >
      <span className="font-martian font-medium text-[9px] text-[#665F5D] tracking-[1.5px] shrink-0">
        {label}
      </span>
      {games.map((g) => (
        <button
          key={g.id}
          type="button"
          onClick={() => onGameClick?.(g)}
          className="flex items-center gap-2 bg-[#1B1715] border border-[#2C2624] hover:border-[#FF6B3D] rounded px-[10px] py-[5px] cursor-pointer whitespace-nowrap shrink-0"
        >
          {g.league && <LeaguePill league={g.league} />}
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
        </button>
      ))}
    </div>
  )
}
