import { useState } from 'react'
import { playerPhotoUrl } from '@/lib/playerPhoto'

interface PlayerAvatarProps {
  league: string
  extId?: string | number | null
  name: string
  /** Team colour used for the ring and the fallback fill. */
  accent: string
  size?: number
}

/** Headshot in a team-coloured ring; initials on the same colour when the image is missing. */
export default function PlayerAvatar({
  league,
  extId,
  name,
  accent,
  size = 84,
}: PlayerAvatarProps) {
  const [failed, setFailed] = useState(false)
  const url = playerPhotoUrl(league, extId)
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')

  return (
    <div
      className="rounded-full overflow-hidden shrink-0 flex items-end justify-center"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 50% 30%, ${accent}66, ${accent}22)`,
        boxShadow: `0 0 0 3px ${accent}`,
      }}
    >
      {url && !failed ? (
        <img
          src={url}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover object-top"
        />
      ) : (
        <span
          className="font-chakra italic font-bold text-[#EFEBE9] self-center"
          style={{ fontSize: size * 0.34 }}
        >
          {initials}
        </span>
      )}
    </div>
  )
}
