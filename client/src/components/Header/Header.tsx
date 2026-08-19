import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { mlbApi, nbaApi, PlayerSearchResult } from "@/services/api";
import { playerPath } from "@/lib/paths";
import { Search } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const NAV_LINKS = [
  { label: "SPORTQUERY", href: "/sportquery" },
  { label: "NBA", href: "/nba" },
  { label: "NFL", href: "/nfl" },
  { label: "MLB", href: "/mlb" },
  { label: "NHL", href: "/nhl" },
  { label: "TRACK", href: "/performance" },
];

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlayerSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Search the league the user is currently browsing so MLB players are
  // findable from the MLB pages (and routed to the MLB player view).
  const searchApi = location.pathname.startsWith("/mlb") ? mlbApi : nbaApi;

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setActiveIdx(-1);
    clearTimeout(debounceRef.current);
    if (val.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchApi.searchPlayers(val);
        setSuggestions(results);
        setOpen(results.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      }
    }, 250);
  }, [searchApi]);

  const handleSelect = useCallback(
    (player: PlayerSearchResult) => {
      setQuery("");
      setSuggestions([]);
      setOpen(false);
      setActiveIdx(-1);
      navigate(playerPath(searchApi.slug, player.id), { state: { player } });
    },
    [navigate, searchApi.slug],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open || suggestions.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = activeIdx >= 0 ? suggestions[activeIdx] : suggestions[0];
        if (target) handleSelect(target);
      } else if (e.key === "Escape") {
        setOpen(false);
        setActiveIdx(-1);
      }
    },
    [open, suggestions, activeIdx, handleSelect],
  );

  const handleBlur = useCallback(() => {
    setTimeout(() => {
      setOpen(false);
      setActiveIdx(-1);
    }, 150);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-[#0A0A0A]/98 backdrop-blur-md border-b border-[#151515] flex items-center px-6 gap-6">
      {/* Logo */}
      <Link to="/" className="flex-shrink-0 flex items-center">
        <span className="font-display text-[22px] font-black tracking-tight text-white leading-none">
          STAT
        </span>
        <span className="font-display text-[22px] font-black tracking-tight text-mint leading-none">
          TRAK
        </span>
        <span className="font-display text-[22px] font-black tracking-tight text-white leading-none">
          SPORTS
        </span>
      </Link>

      {/* Divider */}
      <div className="h-4 w-px bg-[#1E1E1E]" />

      {/* Nav */}
      <nav className="flex gap-0.5">
        {NAV_LINKS.map((link) => {
          const isActive = location.pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              to={link.href}
              className={`relative px-4 py-1.5 text-[13px] font-bold font-condensed tracking-widest uppercase transition-colors ${
                isActive ? "text-white" : "text-gray-600 hover:text-gray-400"
              }`}
            >
              {link.label}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-mint rounded-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Search */}
      <div className="relative ml-auto w-60">
        <Popover open={open}>
          <PopoverTrigger asChild>
            <div className="flex items-center gap-2 bg-[#0F0F0F] border border-[#1E1E1E] rounded-xl px-3 py-1.5 focus-within:border-mint/30 focus-within:bg-[#111] transition-all">
              <Search size={13} className="text-gray-600 flex-shrink-0" />
              <Input
                type="text"
                value={query}
                onChange={handleChange}
                onBlur={handleBlur}
                onFocus={() => suggestions.length > 0 && setOpen(true)}
                onKeyDown={handleKeyDown}
                placeholder="Search players..."
                className="border-0 bg-transparent shadow-none focus-visible:ring-0 p-0 h-auto text-sm text-white placeholder:text-gray-700"
              />
            </div>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            className="w-60 p-1 bg-[#0F0F0F] border-[#222] rounded-xl shadow-2xl animate-fade-up"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {suggestions.map((player, i) => (
              <button
                key={player.id}
                onMouseDown={() => handleSelect(player)}
                className={cn(
                  "w-full text-left px-4 py-3 text-sm cursor-pointer flex items-center justify-between border-b border-[#161616] last:border-0 transition-colors rounded-lg",
                  i === activeIdx ? "bg-white/5" : "hover:bg-white/5",
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#1A1A1A] flex items-center justify-center text-[10px] font-bold text-mint font-condensed flex-shrink-0">
                    {player.name
                      .split(" ")
                      .map((n: string) => n[0])
                      .join("")}
                  </div>
                  <span className="text-gray-200 font-medium">
                    {player.name}
                  </span>
                </div>
                <span className="text-gray-600 text-xs font-condensed">
                  {player.team} · {player.position}
                </span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}
