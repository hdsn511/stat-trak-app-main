import { Link } from 'react-router-dom'

interface Props { league: string }

export default function ComingSoon({ league }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center p-8">
      <div className="text-6xl font-black text-gray-800 mb-4">{league}</div>
      <h2 className="text-xl font-semibold text-white mb-2">Coming Soon</h2>
      <p className="text-gray-500 text-sm mb-8 max-w-xs">
        {league} trend data is on the roadmap. NBA is live right now.
      </p>
      <Link
        to="/nba"
        className="px-6 py-2.5 bg-mint text-black font-semibold rounded-full text-sm hover:bg-mint/90 transition-colors"
      >
        Go to NBA →
      </Link>
    </div>
  )
}
