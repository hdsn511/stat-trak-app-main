import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nbaApi, TopPickPlayer, TopPickGame, TopPicksResponse } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp, Flame } from 'lucide-react'

type CardType = 'player' | 'spread' | 'total' | 'ml'

interface PickCardProps {
  label: string
  type: CardType
  playerPick?: TopPickPlayer | null
  gamePick?: TopPickGame | null
}

function PickCard({ label, type, playerPick, gamePick }: PickCardProps) {
  const navigate = useNavigate()
  const isEmpty = !playerPick && !gamePick

  if (isEmpty) {
    return (
      <div className="flex-1 bg-[#0D0D0D] border border-[#161616] rounded-2xl flex items-center justify-center h-32">
        <span className="text-[10px] text-gray-700 font-condensed uppercase tracking-widest">No {label} pick</span>
      </div>
    )
  }

  const isPlayer = type === 'player'
  const edge = isPlayer ? playerPick!.edge : gamePick!.edge
  const conf = isPlayer ? playerPick!.confidence : gamePick!.confidence
  const hitRate = isPlayer ? playerPick!.hit_rate : gamePick!.hit_rate
  const impliedProb = isPlayer ? playerPick!.implied_prob : (gamePick!.implied_prob ?? 0)
  const edgePct = Math.round(edge * 100)
  const hitPct = Math.round(hitRate * 100)
  const mktPct = Math.round(impliedProb * 100)
  const confInt = Math.round(conf)
  // Bucket: floor to nearest 10, clamp to 50–80 (so 47% → 50 bucket)
  const bucket = Math.min(80, Math.max(50, Math.floor(Math.round(impliedProb * 100) / 10) * 10))

  const title = isPlayer
    ? playerPick!.player_name ?? '—'
    : `${gamePick!.away_team ?? '?'} @ ${gamePick!.home_team ?? '?'}`
  const subtitle = isPlayer
    ? `${playerPick!.team ?? ''} · ${playerPick!.position ?? ''}`
    : type === 'spread' ? 'Spread' : type === 'total' ? 'Total' : 'ML'
  const lineLabel = isPlayer
    ? `OVER ${playerPick!.line} ${playerPick!.stat_label}`
    : type === 'spread' && gamePick!.spread_team && gamePick!.line != null
    ? `${gamePick!.spread_team} -${gamePick!.line}`
    : gamePick!.line != null ? `${gamePick!.line}` : '—'

  return (
    <div
      onClick={() => isPlayer && playerPick!.player_id && navigate(`/player/${playerPick!.player_id}`)}
      className={`flex-1 bg-[#0D0D0D] border rounded-2xl p-4 flex flex-col gap-2 min-w-0 ${
        isPlayer ? 'border-mint/20 cursor-pointer hover:border-mint/40 transition-colors' : 'border-[#161616]'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Flame size={9} className="text-mint flex-shrink-0" />
          <span className="text-[9px] font-bold text-mint uppercase tracking-widest font-condensed">{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Bucket badge: which market % range this pick is in */}
          <span className="text-[9px] font-bold font-mono text-gray-600 border border-[#222] bg-[#111] px-1.5 py-0.5 rounded">
            {bucket}%
          </span>
          <span className="font-mono text-[20px] font-black text-mint leading-none">{confInt}</span>
        </div>
      </div>
      <div>
        <div className="text-[15px] font-bold text-white font-condensed leading-tight truncate">{title}</div>
        <div className="text-[10px] text-gray-600 font-condensed">{subtitle}</div>
      </div>
      <div className="inline-flex items-center gap-1 border border-mint/25 rounded px-1.5 py-0.5 self-start">
        <TrendingUp size={8} className="text-mint" />
        <span className="text-[10px] font-black text-mint font-condensed">{lineLabel}</span>
      </div>
      <div className="space-y-1 mt-auto">
        <div className="flex justify-between">
          <span className="text-[9px] text-gray-700 font-condensed">MKT <span className="font-mono">{mktPct}%</span></span>
          <span className="text-[9px] text-mint font-condensed">HIT <span className="font-mono">{hitPct}%</span> <span className="text-mint/50 font-mono">+{edgePct}%</span></span>
        </div>
        <div className="relative h-0.5 bg-[#1A1A1A] rounded-full overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-gray-700/50 rounded-full" style={{ width: `${mktPct}%` }} />
          <div className="absolute inset-y-0 left-0 bg-mint rounded-full transition-all duration-700" style={{ width: `${hitPct}%` }} />
        </div>
      </div>
    </div>
  )
}

export default function PicksRow() {
  const [picks, setPicks] = useState<TopPicksResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    nbaApi.getTopPicks(5)
      .then(setPicks)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex gap-3">
        {[0,1,2,3].map(i => <Skeleton key={i} className="flex-1 h-32 bg-[#0F0F0F] rounded-2xl" />)}
      </div>
    )
  }

  const playerPick = picks?.player?.[0] ?? null
  const spreadPick = picks?.game?.find(g => g.featured === 'spread') ?? null
  const totalPick  = picks?.game?.find(g => g.featured === 'total')  ?? null
  const mlPick     = picks?.game?.find(g => g.featured === 'ml')     ?? null

  return (
    <div className="flex gap-3">
      <PickCard label="Player Pick" type="player" playerPick={playerPick} />
      <PickCard label="Spread Pick" type="spread" gamePick={spreadPick} />
      <PickCard label="Total Pick"  type="total"  gamePick={totalPick} />
      <PickCard label="ML Pick"     type="ml"     gamePick={mlPick} />
    </div>
  )
}
