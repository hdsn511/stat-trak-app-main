import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'

export default function ProfilePage() {
  const { user, account, ready } = useAuth()
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')

  if (!ready) return null
  if (!account || !user) return <Navigate to="/login" replace />

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password })
    setMsg(error ? error.message : 'Password updated.')
    if (!error) setPassword('')
  }

  return (
    <main className="flex-1 flex justify-center px-4 py-16">
      <div className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="font-chakra italic font-bold text-2xl text-[#EFEBE9]">PROFILE</h1>
        <p className="font-martian text-[13px] text-[#C9C2BE] break-all">{user.email}</p>
        <form onSubmit={changePassword} className="flex flex-col gap-2">
          <input type="password" required minLength={8} autoComplete="new-password"
            aria-label="New password" placeholder="New password (8+ characters)"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full font-martian text-[13px] bg-[#14110F] border border-[#26211E] text-[#EFEBE9] px-3 py-2 rounded" />
          <button type="submit"
            className="font-martian text-[12px] text-[#EFEBE9] border border-[#26211E] rounded py-2 cursor-pointer hover:bg-[#1F1A17]">
            CHANGE PASSWORD
          </button>
        </form>
        {msg && <p role="status" className="font-martian text-[12px] text-[#A8A09C]">{msg}</p>}
        <button onClick={() => supabase.auth.signOut()}
          className="font-martian text-[12px] text-[#FF6B5C] cursor-pointer text-left">
          LOG OUT
        </button>
      </div>
    </main>
  )
}
