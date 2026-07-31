import type { HitRate } from '../derive'

interface LineControlProps {
  label: string
  line: number
  hitRate: HitRate
  versusHitRate: HitRate | null
  versusTeam: string | null
  touched: boolean
  onLine: (v: number) => void
  onReset: () => void
}

function Rate({ caption, r }: { caption: string; r: HitRate }) {
  const tone = r.pct == null ? 'text-[#9A918F]' : r.pct >= 50 ? 'text-[#3FBF7F]' : 'text-[#FF6B5C]'
  return (
    <div>
      <div className="font-martian text-[7px] text-[#665F5D] tracking-[1px]">{caption}</div>
      <div className={`font-martian font-bold text-[15px] mt-[3px] ${tone}`}>
        {`${r.over}/${r.over + r.under} OVER`}
        {r.pct != null && <span className="text-[11px] ml-[6px]">{`${r.pct}%`}</span>}
      </div>
      {r.push > 0 && (
        <div className="font-martian text-[7px] text-[#9A918F] mt-[2px] tracking-[0.5px]">
          {`${r.push} PUSH${r.push > 1 ? 'ES' : ''} EXCLUDED`}
        </div>
      )}
    </div>
  )
}

export default function LineControl({
  label,
  line,
  hitRate,
  versusHitRate,
  versusTeam,
  touched,
  onLine,
  onReset,
}: LineControlProps) {
  const step = (d: number) => onLine(Math.max(0, Math.round((line + d) * 2) / 2))

  return (
    <div className="flex items-end gap-[18px] flex-wrap px-[18px] py-[14px] border-b border-[#27221F]">
      <div>
        <div className="font-martian text-[7px] text-[#665F5D] tracking-[1px]">
          {`${label} LINE · ${touched ? 'MANUAL' : 'AVG'}`}
        </div>
        <div className="flex items-center gap-2 mt-[5px]">
          <button
            type="button"
            aria-label="Lower line"
            onClick={() => step(-0.5)}
            className="font-martian font-bold text-[12px] text-[#9A918F] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md w-[26px] h-[26px] cursor-pointer"
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
            className="font-martian font-bold text-[20px] text-[#EFEBE9] bg-[#221D1A] border border-[#2E2724] rounded-md w-[84px] px-[9px] py-[3px] text-center"
          />
          <button
            type="button"
            aria-label="Raise line"
            onClick={() => step(0.5)}
            className="font-martian font-bold text-[12px] text-[#9A918F] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md w-[26px] h-[26px] cursor-pointer"
          >
            +
          </button>
          {touched && (
            <button
              type="button"
              onClick={onReset}
              className="font-martian text-[8px] text-[#9A918F] hover:text-[#FF6B3D] tracking-[0.5px] underline cursor-pointer ml-1"
            >
              RESET TO AVG
            </button>
          )}
        </div>
      </div>

      <Rate caption="FILTERED SLICE" r={hitRate} />
      {versusHitRate && versusTeam && (
        <Rate caption={`VS ${versusTeam.toUpperCase()}`} r={versusHitRate} />
      )}
    </div>
  )
}
