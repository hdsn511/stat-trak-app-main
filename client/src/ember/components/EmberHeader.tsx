import { Link, NavLink } from 'react-router-dom'
import GlobalSearch from './GlobalSearch'

const NAV_ITEMS = [
  { label: 'HOME', to: '/', end: true },
  { label: 'NBA', to: '/nba' },
  { label: 'MLB', to: '/mlb' },
  { label: 'NFL', to: '/nfl' },
  { label: 'NHL', to: '/nhl' },
  { label: 'SPORTQUERY', to: '/sportquery' },
]

interface EmberHeaderProps {
  meta?: string
}

export default function EmberHeader({ meta = 'ALL LEAGUES · SEASON 2025–26' }: EmberHeaderProps) {
  return (
    // Three-column grid: the middle `auto` track sits at the true centre because
    // the outer tracks are equal (1fr), regardless of logo or search width.
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6 h-[58px] px-[28px] bg-[#0D0B0A] border-b border-[#221E1B] shrink-0">
      <Link
        to="/"
        className="justify-self-start font-chakra italic font-bold text-[19px] tracking-[-0.5px] text-[#EFEBE9] shrink-0"
      >
        STAT<span className="text-[#FF6B3D]">TRAK</span>SPORTS
      </Link>
      <nav className="flex items-center gap-1 p-1 rounded-full bg-[#14110F] border border-[#26211E]">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `font-chakra italic font-semibold text-[13px] leading-none tracking-[1px] px-4 py-[9px] rounded-full transition-colors ${
                isActive
                  ? 'bg-[#EFE9E0] text-[#14100F]'
                  : 'text-[#C9C2BE] hover:text-[#EFEBE9] hover:bg-[#1F1A17]'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="justify-self-end flex items-center gap-4">
        {/* Hidden on narrow viewports so the nav and search never collide. */}
        <span className="hidden 2xl:inline font-martian text-[11px] text-[#A8A09C] tracking-[1.5px]">
          {meta}
        </span>
        <GlobalSearch />
      </div>
    </div>
  )
}
