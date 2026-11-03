import { useCallback, useState } from 'react'
import ModuleCard from '@/ember/components/ModuleCard'
import { EmptyState } from '@/ember/components/EntityState'
import TeamLogo from '@/ember/components/TeamLogo'
import { useEntityData } from '@/ember/useEntityData'
import { createLeagueApi, type NewsItem } from '@/services/api'

function ago(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (m < 60) return `${m}M AGO`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}H AGO` : `${Math.round(h / 24)}D AGO`
}

/** The athlete's face when the story names one, else the first team's crest. */
function Face({ league, item }: { league: string; item: NewsItem }) {
  const [failed, setFailed] = useState(false)
  if (item.athlete && !failed) {
    return (
      <img
        src={item.athlete.headshot}
        alt={item.athlete.name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-[34px] h-[34px] rounded-full object-cover object-top bg-[#2C2624] shrink-0"
      />
    )
  }
  return item.teams[0] ? (
    <TeamLogo league={league} abbr={item.teams[0]} size={34} />
  ) : (
    <span className="w-[34px] h-[34px] rounded-full bg-[#2C2624] shrink-0" />
  )
}

export default function NewsCard({ league, className = '' }: { league: string; className?: string }) {
  const load = useCallback(() => createLeagueApi(league).getNews(), [league])
  const { data, loading, error } = useEntityData<{ items: NewsItem[] }>(load)

  return (
    <ModuleCard title="NEWS" meta="TRADES · INJURIES" className={className}>
      {loading && <EmptyState compact label="LOADING NEWS…" />}
      {!loading && (error || !data) && <EmptyState compact label="NEWS UNAVAILABLE" />}
      {data && data.items.length === 0 && <EmptyState compact label="NO TRADE OR INJURY NEWS RIGHT NOW" />}
      {data?.items.map((n) => (
        <a
          key={n.id}
          href={n.url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="flex gap-3 px-[18px] py-[11px] border-t border-[#221D1A] first:border-t-0 hover:bg-[#211C1A]"
        >
          <Face league={league} item={n} />
          <div className="min-w-0">
            <div className="flex items-center gap-[6px] font-martian text-[10px] tracking-[1px]">
              <span className={n.kind === 'trade' ? 'text-[#FF6B3D]' : 'text-[#FF6B5C]'}>
                {n.kind === 'trade' ? 'TRADE / ROSTER' : 'INJURY / STATUS'}
              </span>
              {n.teams.slice(0, 2).map((t) => (
                <TeamLogo key={t} league={league} abbr={t} size={12} />
              ))}
              <span className="text-[#8A827E]">{ago(n.published)}</span>
            </div>
            <div className="font-schibsted font-bold text-[13px] text-[#EFEBE9] leading-snug mt-[3px]">{n.headline}</div>
          </div>
        </a>
      ))}
    </ModuleCard>
  )
}
