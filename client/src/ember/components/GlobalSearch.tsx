import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchEntities, type PlayerHit, type SearchResults, type TeamHit } from '@/services/api'
import { playerPath, teamPath } from '@/lib/paths'
import LeaguePill from './LeaguePill'

// Cross-league entity search for the header. One flat, keyboard-navigable list
// of players and teams; each hit knows its own league, so a result routes to
// the right sport without the user picking one first.

const DEBOUNCE_MS = 180
const MIN_QUERY = 2

type Hit = PlayerHit | TeamHit

const EMPTY: SearchResults = { players: [], teams: [] }

function hitKey(h: Hit): string {
  return `${h.kind}-${h.league}-${h.id}`
}

function hitPath(h: Hit): string {
  return h.kind === 'player' ? playerPath(h.league, h.id) : teamPath(h.league, h.id)
}

function hitSubtitle(h: Hit): string {
  if (h.kind === 'player') {
    return [h.team, h.position].filter(Boolean).join(' · ') || 'PLAYER'
  }
  return [h.abbreviation, h.city].filter(Boolean).join(' · ') || 'TEAM'
}

export default function GlobalSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(EMPTY)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Players first, then teams — one list so arrow keys cross the boundary.
  const hits = useMemo<Hit[]>(
    () => [...results.players, ...results.teams],
    [results]
  )

  const trimmed = query.trim()

  useEffect(() => {
    if (trimmed.length < MIN_QUERY) {
      setResults(EMPTY)
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(() => {
      searchEntities(trimmed, { limit: 6, signal: controller.signal })
        .then((r) => {
          setResults(r)
          setError(null)
          setActive(0)
          setLoading(false)
        })
        .catch((e: Error) => {
          // An aborted request was superseded by a newer keystroke, not a failure.
          if (e.name === 'AbortError') return
          setResults(EMPTY)
          setError(e.message)
          setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed])

  const close = useCallback(() => {
    setOpen(false)
    setActive(0)
  }, [])

  const go = useCallback(
    (hit: Hit) => {
      setQuery('')
      setResults(EMPTY)
      close()
      inputRef.current?.blur()
      navigate(hitPath(hit))
    },
    [close, navigate]
  )

  // Dismiss on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, close])

  // Ctrl/Cmd-K focuses the box from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      close()
      inputRef.current?.blur()
      return
    }
    if (!hits.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[active]
      if (hit) go(hit)
    }
  }

  const showPanel = open && trimmed.length >= MIN_QUERY

  return (
    <div ref={rootRef} className="relative w-[210px] shrink-0">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="search players, teams…"
        aria-label="Search players and teams"
        className="w-full bg-[#171310] border border-[#2C2624] focus:border-[#FF6B3D] rounded-md pl-[26px] pr-[10px] py-[7px] font-martian text-[10px] text-[#EFEBE9] placeholder:text-[#584F4C] outline-none [&::-webkit-search-cancel-button]:appearance-none"
      />
      <span
        aria-hidden
        className="absolute left-[9px] top-1/2 -translate-y-1/2 font-martian font-bold text-[10px] text-[#FF6B3D] pointer-events-none"
      >
        {'>'}
      </span>

      {showPanel && (
        <div className="absolute top-[calc(100%+6px)] right-0 w-[320px] max-h-[420px] overflow-y-auto bg-[#171310] border border-[#2C2624] rounded-md shadow-[0_12px_32px_rgba(0,0,0,0.55)] z-50 animate-rise">
          {loading && hits.length === 0 && (
            <div className="px-[14px] py-[14px] font-martian text-[9px] text-[#665F5D] tracking-[1px]">
              SEARCHING…
            </div>
          )}

          {error && (
            <div className="px-[14px] py-[14px] font-martian text-[9px] text-[#FF6B5C] tracking-[1px]">
              SEARCH FAILED — {error}
            </div>
          )}

          {!loading && !error && hits.length === 0 && (
            <div className="px-[14px] py-[14px] font-martian text-[9px] text-[#665F5D] tracking-[1px]">
              NO MATCHES FOR “{trimmed}”
            </div>
          )}

          {(['player', 'team'] as const).map((kind) => {
            const group = hits.filter((h) => h.kind === kind)
            if (group.length === 0) return null
            return (
              <div key={kind}>
                <div className="px-[14px] pt-[10px] pb-[5px] font-martian text-[8px] text-[#665F5D] tracking-[1.5px]">
                  {kind === 'player' ? 'PLAYERS' : 'TEAMS'}
                </div>
                {group.map((hit) => {
                  const index = hits.indexOf(hit)
                  return (
                    <button
                      key={hitKey(hit)}
                      type="button"
                      // onMouseDown, not onClick: the input's blur would tear
                      // the panel down before a click could land.
                      onMouseDown={(e) => {
                        e.preventDefault()
                        go(hit)
                      }}
                      onMouseEnter={() => setActive(index)}
                      className={`w-full flex items-center gap-[10px] text-left px-[14px] py-[9px] ${
                        index === active ? 'bg-[#221D1A]' : ''
                      }`}
                    >
                      <LeaguePill league={hit.league.toUpperCase()} />
                      <div className="min-w-0 flex-1">
                        <div className="font-schibsted font-bold text-[12px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
                          {hit.name}
                        </div>
                        <div className="font-martian text-[8px] text-[#665F5D] mt-[2px] whitespace-nowrap overflow-hidden text-ellipsis">
                          {hitSubtitle(hit)}
                        </div>
                      </div>
                      <span
                        aria-hidden
                        className={`font-martian text-[10px] shrink-0 ${
                          index === active ? 'text-[#FF6B3D]' : 'text-[#443E3B]'
                        }`}
                      >
                        →
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
