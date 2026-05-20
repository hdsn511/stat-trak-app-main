interface PerformanceSectionProps {
  title: string
  subtitle?: string
  children: React.ReactNode
  className?: string
}

export default function PerformanceSection({
  title,
  subtitle,
  children,
  className = '',
}: PerformanceSectionProps) {
  return (
    <div className={`bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden ${className}`}>
      <div className="px-4 pt-4 pb-3 border-b border-[#111] flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">
          {title}
        </span>
        {subtitle && (
          <span className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest">
            {subtitle}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}
