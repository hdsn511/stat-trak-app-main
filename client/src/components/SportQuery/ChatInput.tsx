import { useState, type KeyboardEvent } from 'react'

type Props = {
  onSend: (msg: string) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('')

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="px-6 py-4 border-t border-[#161616] bg-[#0A0A0A]">
      <div className="max-w-3xl mx-auto flex items-end gap-2">
        <textarea
          className="flex-1 resize-none bg-[#0D0D0D] border border-[#161616] rounded-xl px-4 py-3 font-sans text-sm text-white placeholder-gray-600 focus:border-mint/50 focus:outline-none"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about players, trends, matchups…"
          disabled={disabled}
        />
        <button
          className="px-4 py-3 rounded-xl bg-mint text-black font-condensed uppercase tracking-[0.2em] text-[10px] disabled:opacity-40"
          onClick={submit}
          disabled={disabled || !value.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}
