import { createClient } from '@supabase/supabase-js'

// Public by design: the anon key only grants what RLS allows. It is used here
// solely for Supabase Auth; all data access goes through the API.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? '',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  { auth: { persistSession: true, autoRefreshToken: true } }
)

let pending: Promise<string> | null = null

/**
 * Bearer token for the API. Visitors get an anonymous Supabase user on first
 * use, which later converts in place to a real account (same id, same history).
 */
export function getAccessToken(): Promise<string> {
  pending ??= (async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session) return data.session.access_token
    const { data: anon, error } = await supabase.auth.signInAnonymously()
    if (error || !anon.session) throw new Error(error?.message ?? 'Could not start a session')
    return anon.session.access_token
  })().finally(() => {
    pending = null
  })
  return pending
}
