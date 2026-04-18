import { useEffect, useState } from 'react'

const KEY = 'sportquery.showSuggestions'

export function useShowSuggestions(): [boolean, (v: boolean) => void] {
  const [show, setShow] = useState<boolean>(() => {
    return localStorage.getItem(KEY) === 'true'
  })
  useEffect(() => {
    localStorage.setItem(KEY, String(show))
  }, [show])
  return [show, setShow]
}

type Props = {
  show: boolean
  onChange: (v: boolean) => void
}

export function SuggestionsToggle({ show, onChange }: Props) {
  return (
    <button
      className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-500 hover:text-mint"
      onClick={() => onChange(!show)}
      title="Toggle follow-up suggestion chips"
    >
      Suggestions: {show ? 'on' : 'off'}
    </button>
  )
}
