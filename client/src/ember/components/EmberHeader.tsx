import { Link, NavLink, useLocation } from 'react-router-dom'
import GlobalSearch from './GlobalSearch'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'

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

export default function EmberHeader({ meta = 'ALL LEAGUES' }: EmberHeaderProps) {
  const { account } = useAuth()
  // Player, game and team pages live under /{kind}/{league}/…: light up that league's tab so you know where you are.
  const deepLeague = useLocation().pathname.match(/^\/(?:player|game|team)\/([a-z]+)\//)?.[1]
  const link = 'font-martian text-[11px] tracking-[1px] text-[#C9C2BE] hover:text-[#EFEBE9] shrink-0'
  return (
    // Desktop: three-column grid; the middle `auto` track sits at the true
    // centre because the outer tracks are equal (1fr), regardless of logo or
    // search width. Below ~1180px the six pills cannot fit beside the logo and
    // search (they pushed the page to ~900px wide on a phone), so the nav drops
    // to its own full-width row that scrolls sideways.
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] min-[1180px]:grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-6 h-[58px] px-3 md:px-[28px] bg-[#0D0B0A] border-b border-[#221E1B] shrink-0">
      <Link
        to="/"
        className="justify-self-start font-chakra italic font-bold text-[19px] tracking-[-0.5px] text-[#EFEBE9] shrink-0"
      >
        <span className="sm:hidden">S<span className="text-[#FF6B3D]">T</span>S</span>
        <span className="hidden sm:inline">STAT<span className="text-[#FF6B3D]">TRAK</span>SPORTS</span>
      </Link>
      <div className="min-w-0 flex justify-center">
      <nav className="max-w-full flex items-center gap-1 p-1 rounded-full bg-[#14110F] border border-[#26211E] overflow-x-auto no-scrollbar">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `font-chakra italic font-semibold text-[13px] leading-none tracking-[1px] px-2.5 md:px-4 py-[9px] rounded-full shrink-0 press ${
                isActive || item.to === `/${deepLeague}`
                  ? 'bg-[#EFE9E0] text-[#14100F]'
                  : 'text-[#C9C2BE] hover:text-[#EFEBE9] hover:bg-[#1F1A17]'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      </div>
      <div className="min-w-0 justify-self-end flex items-center gap-3 md:gap-4">
        {/* Hidden on narrow viewports so the nav and search never collide. */}
        <span className="hidden 2xl:inline font-martian text-[11px] text-[#A8A09C] tracking-[1.5px]">
          {meta}
        </span>
        <GlobalSearch />
        {account ? (
          <>
            <Link to="/profile" className={link}>PROFILE</Link>
            <button onClick={() => supabase.auth.signOut()} className={`${link} cursor-pointer`}>LOG OUT</button>
          </>
        ) : (
          <Link to="/login" className={link}>LOG IN</Link>
        )}
      </div>
    </div>
  )
}
