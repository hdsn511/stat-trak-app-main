interface SegmentedProps<T extends string> {
  options: readonly (readonly [label: string, value: T])[]
  value: T
  onChange: (v: T) => void
  itemClass?: string
}

export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  itemClass = 'px-3',
}: SegmentedProps<T>) {
  return (
    <div className="ml-auto flex border border-[#2C2624] rounded-md overflow-hidden">
      {options.map(([label, v]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`font-martian font-medium text-[9px] py-[6px] cursor-pointer whitespace-nowrap ${itemClass} ${
            v === value
              ? 'bg-[#EFE9E0] text-[#14100F]'
              : 'bg-transparent text-[#9A918F] hover:text-[#EFEBE9]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
