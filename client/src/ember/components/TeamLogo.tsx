import { useState } from 'react'
import { teamLogoUrl, teamAccent } from '@/lib/teamBrand'

interface TeamLogoProps {
  league: string
  abbr: string
  size?: number
  className?: string
}

/**
 * Team crest from ESPN's CDN. Falls back to a coloured abbreviation badge when
 * the image is missing or blocked, so a bad URL never leaves a hole in a row.
 */
export default function TeamLogo({ league, abbr, size = 20, className = '' }: TeamLogoProps) {
  const [failed, setFailed] = useState(false)
  const url = teamLogoUrl(league, abbr)

  if (!url || failed) {
    return (
      <span
        aria-hidden
        className={`inline-flex items-center justify-center rounded-full font-martian font-bold shrink-0 text-[#14100F] ${className}`}
        style={{
          width: size,
          height: size,
          fontSize: Math.max(8, size * 0.38),
          background: teamAccent(league, abbr),
        }}
      >
        {abbr.slice(0, 3)}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`object-contain shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
