import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// Shared loading / error / empty states for the full-page entity views
// (player, game, team). Keeps every route reporting failure the same way
// instead of each page inventing its own spinner.

interface CenteredProps {
  children: ReactNode
  compact?: boolean
}

function Centered({ children, compact = false }: CenteredProps) {
  return (
    <div className={`text-center ${compact ? 'px-[18px] py-16' : 'px-[28px] py-20'}`}>
      {children}
    </div>
  )
}

export function LoadingState({ label, compact }: { label: string; compact?: boolean }) {
  return (
    <Centered compact={compact}>
      <span className="font-martian text-[12px] text-[#A8A09C] tracking-[1px]">{label}</span>
    </Centered>
  )
}

interface ErrorStateProps {
  label: string
  detail?: string | null
  onRetry?: () => void
  compact?: boolean
}

export function ErrorState({ label, detail, onRetry, compact }: ErrorStateProps) {
  return (
    <Centered compact={compact}>
      <div className="font-martian text-[12px] text-[#FF6B5C] tracking-[1px]">
        {detail ? `${label} — ${detail}` : label}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="font-martian text-[11px] text-[#C9C2BE] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md px-[14px] py-[7px] mt-4 cursor-pointer"
        >
          RETRY
        </button>
      )}
    </Centered>
  )
}

export function EmptyState({ label, compact }: { label: string; compact?: boolean }) {
  return (
    <Centered compact={compact}>
      <span className="font-martian text-[12px] text-[#8A827E] tracking-[1.5px]">
        <span className="text-[#FF6B3D] opacity-60">{'// '}</span>
        {label}
      </span>
    </Centered>
  )
}

/** Catch-all for URLs no route matches; without it the page rendered blank. */
export function NotFoundState() {
  return (
    <Centered>
      <div className="font-chakra italic font-bold text-[56px] leading-none text-[#FF6B3D]">404</div>
      <div className="font-martian text-[12px] text-[#A8A09C] tracking-[1px] mt-4">
        NOTHING AT THIS ADDRESS
      </div>
      <Link
        to="/"
        className="inline-block font-martian text-[11px] text-[#C9C2BE] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md px-[14px] py-[7px] mt-6"
      >
        → HOME
      </Link>
    </Centered>
  )
}
