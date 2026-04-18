type Props = { onPick: (prompt: string) => void }

const PROMPTS = [
  'Find guards trending up over the last 10 games',
  "Show today's picks with the biggest Kalshi edges",
  "LeBron's last 10 games without Austin Reaves",
  'Best defenses against centers this season',
]

export function EmptyState({ onPick }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="max-w-xl w-full text-center">
        <div className="font-condensed text-[10px] uppercase tracking-[0.3em] text-gray-600 mb-4">
          SportQuery
        </div>
        <div className="font-display text-4xl text-white mb-2">
          Ask anything about the NBA
        </div>
        <div className="font-sans text-sm text-gray-500 mb-8">
          Trends, matchups, splits, picks — refine conversationally.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => onPick(p)}
              className="text-left px-4 py-3 bg-[#0D0D0D] border border-[#161616] rounded-xl hover:border-mint/40 transition-colors font-sans text-sm text-gray-300"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
