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
  created_at: string
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
  sqlExecuted: string | null = null,
  resultCount: number | null = null
): Promise<MessageRow> {
  const { data, error } = await supabaseAdmin
    .from('sportquery_messages')
    .insert({
      session_id: sessionId,
      role,
      content,
      sql_executed: sqlExecuted,
      result_count: resultCount,
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
