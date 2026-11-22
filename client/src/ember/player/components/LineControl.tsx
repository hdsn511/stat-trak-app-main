import type { HitRate } from '../derive'

interface LineControlProps {
  label: string
  line: number
  hitRate: HitRate
  /** Hit rate against the current line per window (L5, L10, SZN, VS OPP…), props-tool style. */
  strip?: { label: string; r: HitRate; tip: string }[]
  touched: boolean
  onLine: (v: number) => void
  onReset: () => void
}

// Fewer games than this and a hit rate says little, so it is shown neutral, not green/red.
const MIN_SAMPLE = 5

function Rate({ caption, r }: { caption: string; r: HitRate }) {
  const n = r.over + r.under
  const small = n < MIN_SAMPLE
  const tone = r.pct == null || small ? 'text-[#C9C2BE]' : r.pct >= 50 ? 'text-[#3FBF7F]' : 'text-[#FF6B5C]'
  return (
    <div>
      <div className="font-martian text-[10px] text-[#A8A09C] tracking-[1px]">
        {caption}
        {small && n > 0 && (
          <span className="ml-[6px] text-[#FFB020]" title={`Only ${n} game${n === 1 ? '' : 's'}: too few to read much into`}>
            · SMALL SAMPLE
          </span>
        )}
      </div>
      <div className={`font-martian font-bold text-[20px] mt-[3px] tabular-nums ${tone}`}>
        {`${r.over}/${r.over + r.under} OVER`}
        {r.pct != null && <span className="text-[15px] ml-[6px]">{`${r.pct}%`}</span>}
      </div>
      {r.push > 0 && (
        <div className="font-martian text-[10px] text-[#C9C2BE] mt-[2px] tracking-[0.5px]">
          {`${r.push} PUSH${r.push > 1 ? 'ES' : ''} EXCLUDED`}
        </div>
      )}
    </div>
  )
}

/** One window's record against the line: label, "3/5", and the % in hit/miss colour. */
function Chip({ label, r, tip }: { label: string; r: HitRate; tip: string }) {
  const n = r.over + r.under
  const tone = r.pct == null || n < MIN_SAMPLE ? '#C9C2BE' : r.pct >= 60 ? '#3FBF7F' : r.pct <= 40 ? '#FF6B5C' : '#E9B949'
  return (
    <div
      className="min-w-[72px] rounded-md border border-[#2C2624] bg-[#1F1A18] px-[10px] py-[7px] text-center"
      title={`${tip}${r.push ? ` · ${r.push} push` : ''}`}
    >
      <div className="font-martian text-[10px] text-[#A8A09C] tracking-[1px]">{label}</div>
      <div className="font-martian font-bold text-[18px] leading-none mt-[5px] tabular-nums" style={{ color: tone }}>
        {r.pct == null ? '—' : `${r.pct}%`}
      </div>
      <div className="font-martian text-[11px] text-[#A8A09C] mt-[4px] tabular-nums">{n > 0 ? `${r.over}/${n}` : r.push > 0 ? `${r.push} push` : 'no games'}</div>
    </div>
  )
}

export default function LineControl({
  label,
  line,
  hitRate,
  strip = [],
  touched,
  onLine,
  onReset,
}: LineControlProps) {
  const step = (d: number) => onLine(Math.max(0, Math.round((line + d) * 2) / 2))

  return (
    <div className="flex items-end gap-[18px] flex-wrap px-[18px] py-[14px] border-b border-[#27221F]">
      <div>
        <div className="font-martian text-[10px] text-[#A8A09C] tracking-[1px]">
          {`${label} LINE · ${touched ? 'MANUAL' : 'AVG'}`}
        </div>
        <div className="flex items-center gap-2 mt-[5px]">
          <button
            type="button"
            aria-label="Lower line"
            onClick={() => step(-0.5)}
            className="font-martian font-bold text-[14px] text-[#C9C2BE] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md w-[26px] h-[26px] cursor-pointer press"
          >
            −
          </button>
          <input
            aria-label="Line value"
            type="number"
            step={0.5}
            min={0}
            value={line}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) onLine(v)
            }}
            // Spinner arrows steal ~17px of a number input's width, clipping
            // values like "11.5". The ± buttons already cover stepping.
            className="font-martian font-bold text-[24px] text-[#EFEBE9] bg-[#221D1A] border border-[#2E2724] rounded-md w-[96px] px-[9px] py-[3px] text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            type="button"
            aria-label="Raise line"
            onClick={() => step(0.5)}
            className="font-martian font-bold text-[14px] text-[#C9C2BE] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md w-[26px] h-[26px] cursor-pointer press"
          >
            +
          </button>
          {touched && (
            <button
              type="button"
              onClick={onReset}
              className="font-martian text-[10px] text-[#C9C2BE] hover:text-[#FF6B3D] tracking-[0.5px] underline cursor-pointer ml-1"
            >
              RESET TO AVG
            </button>
          )}
        </div>
      </div>

      <Rate caption="FILTERED SLICE" r={hitRate} />
      {strip.length > 0 && (
        // Same windows every prop tool leads with, all against this one line.
        <div className="ml-auto flex flex-wrap gap-[8px]">
          {strip.map((c) => (
            <Chip key={c.label} {...c} />
          ))}
        </div>
      )}
    </div>
  )
}
