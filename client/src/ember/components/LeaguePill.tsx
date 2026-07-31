interface LeaguePillProps {
  league: string
  onPaper?: boolean
}

export default function LeaguePill({ league }: LeaguePillProps) {
  return (
    <span className="inline-block bg-[#14100F] text-white font-martian font-bold text-[8px] tracking-[0.5px] rounded-[3px] px-[6px] py-[2px] leading-none shrink-0">
      {league}
    </span>
  )
}
