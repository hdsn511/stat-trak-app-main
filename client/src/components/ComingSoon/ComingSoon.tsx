import { Link } from 'react-router-dom'
import { ArrowRight, BarChart2, TrendingUp, Target } from 'lucide-react'

interface Props { league: string }

const FEATURES = [
  { icon: BarChart2, label: 'Player Trends' },
  { icon: TrendingUp, label: 'Trend Finder' },
  { icon: Target, label: 'Hit Rate Analysis' },
]

export default function ComingSoon({ league }: Props) {
  return (
    <div className="relative flex flex-col items-center justify-center h-full min-h-[60vh] text-center p-8 overflow-hidden">
      {/* Background watermark */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
        <span
          className="font-black text-white/[0.025] font-condensed tracking-tighter leading-none"
          style={{ fontSize: 'clamp(120px, 22vw, 280px)' }}
        >
          {league}
        </span>
      </div>

      {/* Content */}
      <div className="relative z-10 animate-fade-up">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-[#0F0F0F] border border-[#1E1E1E] rounded-full mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500/70" />
          <span className="text-[10px] font-bold text-gray-600 font-condensed tracking-[0.2em] uppercase">
            Coming Soon
          </span>
        </div>

        <h1
          className="font-black text-white font-condensed tracking-tight leading-none mb-3"
          style={{ fontSize: 'clamp(64px, 10vw, 96px)' }}
        >
          {league}
        </h1>

        <p className="text-sm text-gray-600 mb-8 max-w-sm mx-auto leading-relaxed">
          {league} trend data is on the roadmap. NBA is live right now with full player analysis.
        </p>

        {/* Feature teasers */}
        <div className="flex gap-2.5 justify-center mb-8 flex-wrap">
          {FEATURES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 px-3.5 py-2 bg-[#0D0D0D] border border-[#161616] rounded-xl"
            >
              <Icon size={12} className="text-gray-700" />
              <span className="text-[11px] text-gray-600 font-condensed tracking-wide">{label}</span>
            </div>
          ))}
        </div>

        <Link
          to="/nba"
          className="inline-flex items-center gap-2.5 px-7 py-3 bg-mint text-black font-black rounded-xl text-[13px] font-condensed tracking-widest uppercase hover:bg-mint/90 transition-colors group"
        >
          Explore NBA
          <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </div>
  )
}
