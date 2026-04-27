import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nbaApi, Pick } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Flame, ArrowRight, TrendingUp } from 'lucide-react'

export default function PickOfTheDay() {
  const navigate = useNavigate()
  const [pick, setPick]     = useState<Pick | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    nbaApi.getTodaysPicks()
      .then(({ topPick }) => setPick(topPick))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <Skeleton className="h-44 w-full bg-[#0F0F0F] rounded-2xl" />
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!pick) {
    return (
      <div className="relative w-full overflow-hidden rounded-2xl border border-[#1A1A1A] bg-[#0D0D0D] flex items-center justify-center h-44">
        <div className="flex items-center gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-mint animate-pulse-live" />
          <span className="text-[11px] text-gray-600 font-condensed uppercase tracking-[0.2em]">
            Analyzing today's slate...
          </span>
        </div>
      </div>
    )
  }

  // ── Pick card ─────────────────────────────────────────────────────────────
  const confidenceInt = Math.round(pick.confidence)
  const hitPct        = Math.round(pick.hitRate * 100)
  const mktPct        = Math.round(pick.impliedProb * 100)
  const edgePct       = Math.round(pick.edge * 100)

  return (
    <Card
      onClick={() => navigate(`/player/${pick.playerId}`)}
      className="relative w-full overflow-hidden rounded-2xl border border-mint/20 text-left group transition-all hover:border-mint/40 cursor-pointer shadow-none bg-transparent"
      style={{ background: 'linear-gradient(135deg, #0D1F18 0%, #0A0A0A 55%, #0A0C14 100%)' }}
    >
      {/* Radial glow */}
      <div
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          background:
            'radial-gradient(ellipse 55% 90% at 88% 50%, rgba(42,255,200,0.12) 0%, transparent 70%)',
        }}
      />

      {/* Pick type badge — top right */}
      <div
        className={`absolute top-3 right-10 text-[9px] font-black font-condensed tracking-widest px-1.5 py-0.5 rounded ${
          pick.pickType === 'safe'
            ? 'bg-mint/10 text-mint border border-mint/20'
            : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
        }`}
      >
        {pick.pickType.toUpperCase()}
      </div>

      <CardContent className="relative flex items-center gap-5 p-5 pr-4">
        {/* ── Left column ── */}
        <div className="flex-1 min-w-0">
          {/* Section label */}
          <div className="flex items-center gap-1.5 mb-3">
            <Flame size={11} className="text-mint" />
            <span className="text-[10px] font-black text-mint uppercase tracking-[0.18em] font-condensed">
              Pick of the Day
            </span>
          </div>

          {/* Player name */}
          <h2 className="text-[24px] font-black text-white font-condensed tracking-tight leading-none mb-0.5 group-hover:text-mint transition-colors truncate">
            {pick.playerName}
          </h2>
          <p className="text-xs text-gray-600 mb-3">
            {pick.team} · {pick.position}
          </p>

          {/* Recommended line badge */}
          <div className="inline-flex items-center gap-1.5 border border-mint/30 rounded px-2 py-1 mb-3.5">
            <TrendingUp size={9} className="text-mint" />
            <span className="text-[11px] font-black text-mint font-condensed tracking-wide">
              OVER {pick.recommendedLine} {pick.statLabel}
            </span>
          </div>

          {/* Edge bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-gray-600 font-condensed uppercase tracking-wider">
                MKT <span className="font-mono">{mktPct}%</span>
              </span>
              <span className="text-[9px] font-bold text-mint font-condensed">
                HIT <span className="font-mono">{hitPct}%</span>{' '}
                <span className="text-mint/50 font-mono">+{edgePct}%</span>
              </span>
            </div>
            <div className="relative h-1 bg-[#1A1A1A] rounded-full overflow-hidden">
              {/* Market implied prob — gray base */}
              <div
                className="absolute inset-y-0 left-0 bg-gray-700/60 rounded-full"
                style={{ width: `${mktPct}%` }}
              />
              {/* Our hit rate — mint overlay */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-mint/50 to-mint transition-all duration-700"
                style={{ width: `${hitPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* ── Right column — confidence score ── */}
        <div className="flex-shrink-0 flex flex-col items-end">
          <div className="text-[76px] font-black text-mint font-display leading-none text-glow-mint tabular-nums">
            {confidenceInt}
          </div>
          <div className="text-[11px] text-gray-600 mt-0.5 font-condensed tracking-wide text-right">
            CONF
          </div>
        </div>

        <ArrowRight
          size={15}
          className="flex-shrink-0 text-gray-700 group-hover:text-mint group-hover:translate-x-0.5 transition-all self-center ml-1"
        />
      </CardContent>
    </Card>
  )
}
