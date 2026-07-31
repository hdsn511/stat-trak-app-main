import { Link, NavLink } from 'react-router-dom'

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
    <div className="flex items-center gap-6 h-[58px] px-[28px] bg-[#0D0B0A] border-b border-[#221E1B] shrink-0">
      <Link
        to="/"
        className="font-chakra italic font-bold text-[19px] tracking-[-0.5px] text-[#EFEBE9]"
      >
        STAT<span className="text-[#FF6B3D]">TRAK</span>SPORTS
      </Link>
      <nav className="flex gap-[2px]">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `font-chakra italic font-semibold text-[13px] leading-none tracking-[1px] px-3 py-[19px] ${
                isActive
                  ? 'text-[#EFEBE9] border-b-2 border-[#FF6B3D]'
                  : 'text-[#665F5D] hover:text-[#EFEBE9]'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <span className="ml-auto font-martian text-[9px] text-[#665F5D] tracking-[1.5px]">
        {meta}
      </span>
    </div>
  )
}
