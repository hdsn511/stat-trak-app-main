import { useState } from 'react'

interface AskBarProps {
  placeholder: string
  onSubmit: (q: string) => void
  className?: string
}

export default function AskBar({ placeholder, onSubmit, className = '' }: AskBarProps) {
  const [value, setValue] = useState('')

  const submit = () => {
    const q = value.trim()
    if (!q) return
    onSubmit(q)
    setValue('')
  }

  return (
    <div
      className={`flex items-center gap-[10px] bg-white border-2 border-[#14100F] rounded-lg pl-4 pr-1 py-1 shadow-[3px_3px_0_#FF6B3D] ${className}`}
    >
      <span className="font-martian font-bold text-[11px] text-[#C2410C] shrink-0">&gt;_</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent font-martian text-[13px] text-[#14100F] placeholder:text-[#A09793] outline-none"
      />
      <button
        type="button"
        onClick={submit}
        className="font-chakra italic font-bold text-[12px] tracking-[1px] bg-[#14100F] text-[#FF6B3D] rounded px-[18px] py-[9px] cursor-pointer shrink-0"
      >
        ASK
      </button>
    </div>
  )
}
