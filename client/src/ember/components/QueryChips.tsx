interface QueryChipsProps {
  chips: string[]
  onSelect?: (c: string) => void
  variant?: 'dark' | 'paper'
}

export default function QueryChips({ chips, onSelect, variant = 'dark' }: QueryChipsProps) {
  const chipClass =
    variant === 'paper'
      ? 'bg-white border-[#E4E0D6] text-[rgba(20,16,15,0.7)] hover:border-[#D9481F] hover:text-[#D9481F]'
      : 'bg-[#1B1715] border-[#2C2624] text-[#9A918F] hover:border-[#FF6B3D] hover:text-[#EFEBE9]'

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          onClick={() => onSelect?.(chip)}
          className={`font-martian text-[10px] border rounded-[14px] px-3 py-[5px] cursor-pointer whitespace-nowrap ${chipClass}`}
        >
          {chip}
        </button>
      ))}
    </div>
  )
}
