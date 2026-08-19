import { ReactNode } from 'react'

interface ModuleCardProps {
  title: string
  meta?: ReactNode
  children: ReactNode
  className?: string
  headerRight?: ReactNode
  onPaper?: boolean
}

export default function ModuleCard({
  title,
  meta,
  children,
  className = '',
  headerRight,
  onPaper = false,
}: ModuleCardProps) {
  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        onPaper ? 'bg-white border-[#E4E0D6]' : 'bg-[#1B1715] border-[#2C2624]'
      } ${className}`}
    >
      <div
        className={`flex items-center gap-3 px-[18px] py-[13px] border-b ${
          onPaper ? 'border-[#E4E0D6]' : 'border-[#27221F]'
        }`}
      >
        <span
          className={`font-chakra italic font-bold text-[13px] tracking-[0.5px] ${
            onPaper ? 'text-[#14100F]' : 'text-[#EFEBE9]'
          }`}
        >
          <span className={onPaper ? 'text-[#D9481F]' : 'text-[#FF6B3D]'}>{'// '}</span>
          {title}
        </span>
        {headerRight ? (
          <div className="ml-auto">{headerRight}</div>
        ) : (
          meta !== undefined && (
            <span
              className={`ml-auto text-right font-martian text-[8px] tracking-[1px] ${
                onPaper ? 'text-[#78716A]' : 'text-[#665F5D]'
              }`}
            >
              {meta}
            </span>
          )
        )}
      </div>
      {children}
    </div>
  )
}
