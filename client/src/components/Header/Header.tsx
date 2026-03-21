import { useState, useCallback, useRef } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Search } from 'lucide-react'
import { nbaApi, PlayerSearchResult } from '@/services/api'

const NAV_LINKS = [
  { label: 'NBA', href: '/nba' },
  { label: 'NFL', href: '/nfl' },
  { label: 'MLB', href: '/mlb' },
  { label: 'NHL', href: '/nhl' },
]

export default function Header() {
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<PlayerSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    clearTimeout(debounceRef.current)
    if (val.trim().length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await nbaApi.searchPlayers(val)
        setSuggestions(results)
        setOpen(results.length > 0)
      } catch {
        setSuggestions([])
        setOpen(false)
      }
    }, 250)
  }, [])

  const handleSelect = useCallback((player: PlayerSearchResult) => {
    setQuery('')
    setSuggestions([])
    setOpen(false)
    navigate(`/player/${player.id}`, { state: { player } })
  }, [navigate])

  const handleBlur = useCallback(() => {
    setTimeout(() => setOpen(false), 150)
  }, [])

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-[#0A0A0A]/98 backdrop-blur-md border-b border-[#151515] flex items-center px-6 gap-6">
      {/* Logo */}
      <Link to="/" className="flex-shrink-0 flex items-center">
        <span className="font-display text-[22px] font-black tracking-tight text-white leading-none">STAT</span>
        <span className="font-display text-[22px] font-black tracking-tight text-mint leading-none">TRAK</span>
      </Link>

      {/* Divider */}
      <div className="h-4 w-px bg-[#1E1E1E]" />

      {/* Nav */}
      <nav className="flex gap-0.5">
        {NAV_LINKS.map(link => {
          const isActive = location.pathname.startsWith(link.href)
          return (
            <Link
              key={link.href}
              to={link.href}
              className={`relative px-4 py-1.5 text-[13px] font-bold font-condensed tracking-widest uppercase transition-colors ${
                isActive ? 'text-white' : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              {link.label}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-mint rounded-full" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Search */}
      <div className="relative ml-auto w-60">
        <div className="flex items-center gap-2 bg-[#0F0F0F] border border-[#1E1E1E] rounded-xl px-3 py-2 focus-within:border-mint/30 focus-within:bg-[#111] transition-all">
          <Search size={13} className="text-gray-600 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={handleChange}
            onBlur={handleBlur}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder="Search players..."
            className="bg-transparent text-sm text-white placeholder-gray-700 outline-none w-full"
          />
          {!query && (
            <kbd className="text-[10px] text-gray-700 border border-[#222] rounded px-1.5 py-0.5 font-condensed flex-shrink-0 leading-4">
              ⌘K
            </kbd>
          )}
        </div>
        {open && (
          <ul className="absolute top-full mt-1.5 left-0 right-0 bg-[#0F0F0F] border border-[#222] rounded-xl overflow-hidden z-50 shadow-2xl animate-fade-up">
            {suggestions.map(player => (
              <li
                key={player.id}
                onMouseDown={() => handleSelect(player)}
                className="px-4 py-3 text-sm cursor-pointer hover:bg-white/5 flex items-center justify-between border-b border-[#161616] last:border-0 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#1A1A1A] flex items-center justify-center text-[10px] font-bold text-mint font-condensed flex-shrink-0">
                    {player.name.split(' ').map((n: string) => n[0]).join('')}
                  </div>
                  <span className="text-gray-200 font-medium">{player.name}</span>
                </div>
                <span className="text-gray-600 text-xs font-condensed">{player.team} · {player.position}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </header>
  )
}
