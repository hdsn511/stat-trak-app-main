import { supabaseAdmin } from '../config/supabaseAdmin'

export type SessionRow = {
  id: string
  user_id: string
  title: string | null
  created_at: string
  updated_at: string
}

export type MessageRow = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  sql_executed: string | null
  result_count: number | null
  /** Rows this turn returned, so reopening the session rehydrates its cards. */
  result_rows: unknown[] | null
  result_shape: string | null
  created_at: string
}

export type AppendExtras = {
  sqlExecuted?: string | null
  resultCount?: number | null
  resultRows?: unknown[] | null
  resultShape?: string | null
}

export async function createSession(userId = 'local'): Promise<SessionRow> {
  const { data, error } = await supabaseAdmin
    .from('sportquery_sessions')
    .insert({ user_id: userId })
    .select('*')
    .single()
  if (error) throw error
  return data as SessionRow
}

export async function listSessions(userId = 'local'): Promise<SessionRow[]> {
  const { data, error } = await supabaseAdmin
    .from('sportquery_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data as SessionRow[]
}

export async function getMessages(sessionId: string): Promise<MessageRow[]> {
  const { data, error } = await supabaseAdmin
    .from('sportquery_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as MessageRow[]
}

export async function appendMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  extras: AppendExtras = {}
): Promise<MessageRow> {
  const { data, error } = await supabaseAdmin
    .from('sportquery_messages')
    .insert({
      session_id: sessionId,
      role,
      content,
      sql_executed: extras.sqlExecuted ?? null,
      result_count: extras.resultCount ?? null,
      // Cap what is persisted: a 500-row result set is not worth storing in
      // full, and the UI only ever renders the head of the list.
      result_rows: extras.resultRows ? extras.resultRows.slice(0, 50) : null,
      result_shape: extras.resultShape ?? null,
    })
    .select('*')
    .single()
  if (error) throw error

  await supabaseAdmin
    .from('sportquery_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  return data as MessageRow
}

export async function setSessionTitle(
  sessionId: string,
  title: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('sportquery_sessions')
    .update({ title: title.slice(0, 120) })
    .eq('id', sessionId)
  if (error) throw error
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('sportquery_sessions')
    .delete()
    .eq('id', sessionId)
  if (error) throw error
}
