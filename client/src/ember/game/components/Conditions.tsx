import type { GameInsights } from '@/services/api'
import { BAD, GOOD, WARN } from './insightTones'

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-[78px]">
      <div className="font-martian text-[9px] text-[#8A827E] tracking-[1px]">{label}</div>
      <div className="font-martian font-bold text-[15px] mt-[3px] tabular-nums" style={{ color: tone ?? '#EFEBE9' }}>
        {value}
      </div>
    </div>
  )
}

/**
 * Venue and kickoff weather. Only NFL games carry weather; indoor stadiums
 * show the venue and a one-line note instead of a forecast.
 */
export default function Conditions({ insights }: { insights: GameInsights }) {
  const { venue, weather, weather_note: note } = insights
  if (insights.league !== 'nfl' || (!venue && !weather && !note)) return null

  const wind = weather ? Math.max(weather.wind_mph ?? 0, weather.gust_mph ?? 0) : 0
  const windTone = !weather ? undefined : (weather.wind_mph ?? 0) >= 18 ? BAD : (weather.wind_mph ?? 0) >= 12 ? WARN : GOOD
  const precipTone = !weather || weather.precip_prob == null ? undefined : weather.precip_prob >= 50 ? BAD : weather.precip_prob >= 25 ? WARN : GOOD
  const tempTone = !weather || weather.temp_f == null ? undefined : weather.temp_f <= 32 ? BAD : weather.temp_f >= 88 ? WARN : undefined

  return (
    <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg px-[18px] py-[12px] flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="min-w-0">
        <div className="font-chakra italic font-bold text-[13px] text-[#EFEBE9]">
          <span className="text-[#FF6B3D]">{'// '}</span>CONDITIONS
        </div>
        {venue && (
          <div className="font-martian text-[11px] text-[#C9C2BE] mt-[3px] truncate">
            {venue.name}
            {venue.city && <span className="text-[#8A827E]"> · {[venue.city, venue.state].filter(Boolean).join(', ')}</span>}
            <span className="text-[#8A827E]">
              {' · '}
              {venue.roof === 'dome' ? 'DOME' : venue.roof === 'retractable' ? 'RETRACTABLE ROOF' : 'OPEN AIR'}
              {venue.grass != null && ` · ${venue.grass ? 'GRASS' : 'TURF'}`}
            </span>
          </div>
        )}
      </div>

      {weather ? (
        <>
          <div className="flex items-center gap-5">
            <Stat label="KICKOFF" value={weather.temp_f != null ? `${weather.temp_f}°F` : '—'} tone={tempTone} />
            <Stat
              label="WIND"
              value={weather.wind_mph != null ? `${weather.wind_mph}${weather.gust_mph && weather.gust_mph > (weather.wind_mph ?? 0) ? `–${weather.gust_mph}` : ''} MPH` : wind ? `G ${wind} MPH` : '—'}
              tone={windTone}
            />
            <Stat label="PRECIP" value={weather.precip_prob != null ? `${weather.precip_prob}%` : '—'} tone={precipTone} />
            {weather.condition && <Stat label="SKY" value={weather.condition.toUpperCase()} />}
          </div>
          <div className="flex flex-wrap gap-2 ml-auto">
            {weather.flags.length === 0 ? (
              <span
                className="font-martian font-bold text-[10px] tracking-[1px] rounded-[3px] px-[7px] py-[4px] border"
                style={{ color: GOOD, borderColor: `${GOOD}66`, background: `${GOOD}14` }}
              >
                NO WEATHER IMPACT
              </span>
            ) : (
              weather.flags.map((f) => {
                const c = f.tone === 'bad' ? BAD : WARN
                return (
                  <span
                    key={f.label}
                    className="font-martian font-bold text-[10px] tracking-[1px] rounded-[3px] px-[7px] py-[4px] border"
                    style={{ color: c, borderColor: `${c}66`, background: `${c}14` }}
                  >
                    {f.label}
                  </span>
                )
              })
            )}
          </div>
          <div className="basis-full font-martian text-[9px] text-[#665F5D] tracking-[0.5px] -mt-1">
            {weather.source === 'open-meteo' ? 'FORECAST FOR KICKOFF HOUR · OPEN-METEO' : 'FORECAST · ESPN'}
          </div>
        </>
      ) : (
        note && <span className="ml-auto font-martian text-[11px] text-[#A8A09C] tracking-[1px]">{note}</span>
      )}
    </div>
  )
}
