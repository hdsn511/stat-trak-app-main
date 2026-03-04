import { useState, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-[#0A0A0A]/95 backdrop-blur border-b border-[#1E1E1E] flex items-center px-6 gap-8">
      {/* Logo */}
      <Link to="/" className="flex-shrink-0 flex items-center">
        <span className="font-display text-xl font-black text-mint">Stat</span>
        <span className="font-display text-xl font-black text-white">Trak</span>
      </Link>

      {/* Nav */}
      <nav className="flex gap-1">
        {NAV_LINKS.map(link => (
          <Link
            key={link.href}
            to={link.href}
            className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 rounded-md transition-colors"
          >
            {link.label}
          </Link>
        ))}
      </nav>

      {/* Search */}
      <div className="relative ml-auto w-64">
        <div className="flex items-center gap-2 bg-[#141414] border border-[#1E1E1E] rounded-lg px-3 py-2 focus-within:border-mint/50 transition-colors">
          <Search size={14} className="text-gray-500 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={handleChange}
            onBlur={handleBlur}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder="Search players..."
            className="bg-transparent text-sm text-white placeholder-gray-500 outline-none w-full"
          />
        </div>
        {open && (
          <ul className="absolute top-full mt-1 left-0 right-0 bg-[#141414] border border-[#1E1E1E] rounded-lg overflow-hidden z-50 shadow-xl">
            {suggestions.map(player => (
              <li
                key={player.id}
                onMouseDown={() => handleSelect(player)}
                className="px-4 py-2.5 text-sm cursor-pointer hover:bg-white/5 flex justify-between items-center"
              >
                <span className="text-white">{player.name}</span>
                <span className="text-gray-500 text-xs">{player.team} · {player.position}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </header>
  )
}
