import { useState } from 'react'
import { supabase } from '@/lib/supabase'

/** Converts the anonymous visitor into a real account (same user id, history kept). */
export function SignUpPrompt() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('sending')
    const { error } = await supabase.auth.updateUser({ email: email.trim() })
    if (error) {
      setState('error')
      setMsg(error.message)
    } else {
      setState('sent')
    }
  }

  if (state === 'sent') {
    return (
      <span className="font-martian text-[12px] text-[#2AFFC8] shrink-0">
        CHECK YOUR EMAIL TO CONFIRM
      </span>
    )
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-2 shrink-0">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        aria-label="Email address"
        className="font-martian text-[12px] bg-[#0D0D0D] border border-[#3A2320] text-[#EFEBE9] px-2 py-1 w-[190px]"
      />
      <button
        type="submit"
        disabled={state === 'sending'}
        className="font-martian text-[11px] text-[#2AFFC8] hover:text-[#EFEBE9] cursor-pointer disabled:opacity-50"
      >
        SIGN UP FREE
      </button>
      {state === 'error' && <span className="font-martian text-[11px] text-[#FF6B5C]">{msg}</span>}
    </form>
  )
}
