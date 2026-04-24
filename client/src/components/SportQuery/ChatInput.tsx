import { useState, type KeyboardEvent } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

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
        <Textarea
          className="flex-1 resize-none min-h-0 bg-[#0D0D0D] border border-[#161616] rounded-xl px-4 py-3 font-sans text-sm text-white placeholder-gray-600 focus-visible:ring-0 focus-visible:ring-offset-0 focus:border-mint/50"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about players, trends, matchups…"
          disabled={disabled}
        />
        <Button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="px-4 py-3 rounded-xl bg-mint text-black font-condensed uppercase tracking-[0.2em] text-[10px] disabled:opacity-40 h-auto"
        >
          Send
        </Button>
      </div>
    </div>
  )
}
