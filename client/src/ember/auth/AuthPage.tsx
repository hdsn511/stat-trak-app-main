import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'

const input =
  'w-full font-martian text-[13px] bg-[#14110F] border border-[#26211E] text-[#EFEBE9] px-3 py-2 rounded'

export default function AuthPage() {
  const { account, ready } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  if (ready && account) return <Navigate to="/profile" replace />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    let error
    if (mode === 'login') {
      ;({ error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }))
      if (!error) navigate('/profile')
    } else {
      // Upgrade the anonymous visitor in place so their history is kept.
      ;({ error } = await supabase.auth.updateUser({ email: email.trim(), password }))
      if (!error) setMsg('Check your email to confirm your account.')
    }
    if (error) setMsg(error.message)
    setBusy(false)
  }

  async function reset() {
    if (!email.trim()) return setMsg('Enter your email first.')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/profile`,
    })
    setMsg(error ? error.message : 'Password reset email sent.')
  }

  return (
    <main className="flex-1 flex justify-center px-4 py-16">
      <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-3">
        <h1 className="font-chakra italic font-bold text-2xl text-[#EFEBE9]">
          {mode === 'login' ? 'LOG IN' : 'SIGN UP'}
        </h1>
        <input type="email" required autoComplete="email" aria-label="Email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        <input type="password" required minLength={8} aria-label="Password" placeholder="Password (8+ characters)"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
        <button type="submit" disabled={busy}
          className="font-chakra italic font-semibold bg-[#EFE9E0] text-[#14100F] rounded py-2 disabled:opacity-50 cursor-pointer">
          {mode === 'login' ? 'LOG IN' : 'CREATE ACCOUNT'}
        </button>
        {msg && <p role="status" className="font-martian text-[12px] text-[#A8A09C]">{msg}</p>}
        <div className="flex justify-between font-martian text-[11px] text-[#A8A09C]">
          <button type="button" className="cursor-pointer hover:text-[#EFEBE9]"
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMsg('') }}>
            {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Log in'}
          </button>
          {mode === 'login' && (
            <button type="button" className="cursor-pointer hover:text-[#EFEBE9]" onClick={reset}>
              Forgot password?
            </button>
          )}
        </div>
      </form>
    </main>
  )
}
