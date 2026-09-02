import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from '@/lib/ai/types'
import type { AnalystPrincipal } from '@/lib/ai/analyst/types'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface CursorValue {
  updatedAt: string
  id: string
}

interface ConversationRow {
  id: string
  title: string
  company_id: string | null
  deal_id: string | null
  scope: string | null
  message_count: number
  messages?: unknown
  summary?: string | null
  created_at: string
  updated_at: string
}

export class ConversationRequestError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'INVALID_REQUEST') {
    super(message)
  }
}

function encodeCursor(row: Pick<ConversationRow, 'updated_at' | 'id'>): string {
  return Buffer.from(JSON.stringify({ updatedAt: row.updated_at, id: row.id })).toString('base64url')
}

function decodeCursor(value: string): CursorValue {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorValue
    const updatedAt = new Date(parsed.updatedAt)
    if (!UUID.test(parsed.id) || Number.isNaN(updatedAt.getTime())) throw new Error('invalid')
    return { updatedAt: updatedAt.toISOString(), id: parsed.id }
  } catch {
    throw new ConversationRequestError('The conversation cursor is invalid.', 400, 'INVALID_CURSOR')
  }
}

function compact(row: ConversationRow) {
  return {
    id: row.id,
    title: row.title,
    companyId: row.company_id,
    dealId: row.deal_id,
    scope: row.scope,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function conversationLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT
  if (!/^\d+$/.test(raw)) throw new ConversationRequestError('limit must be an integer.', 400, 'INVALID_LIMIT')
  const limit = Number(raw)
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new ConversationRequestError(`limit must be between 1 and ${MAX_LIMIT}.`, 400, 'INVALID_LIMIT')
  }
  return limit
}

export async function listConversations(
  admin: SupabaseClient,
  principal: AnalystPrincipal,
  options: { limit: number; cursor?: string | null },
) {
  let query: any = admin
    .from('analyst_conversations')
    .select('id, title, company_id, deal_id, scope, message_count, created_at, updated_at')
    .eq('fund_id', principal.fundId)
    .eq('user_id', principal.userId)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(options.limit + 1)

  if (options.cursor) {
    const cursor = decodeCursor(options.cursor)
    query = query.or(`updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as ConversationRow[]
  const hasMore = rows.length > options.limit
  const page = rows.slice(0, options.limit)
  return {
    conversations: page.map(compact),
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  }
}

export async function getConversation(
  admin: SupabaseClient,
  principal: AnalystPrincipal,
  id: string,
) {
  const { data, error } = await admin
    .from('analyst_conversations')
    .select('id, title, company_id, deal_id, scope, message_count, messages, summary, created_at, updated_at')
    .eq('id', id)
    .eq('fund_id', principal.fundId)
    .eq('user_id', principal.userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as ConversationRow
  return {
    ...compact(row),
    summary: row.summary ?? null,
    messages: normalizeMessages(row.messages),
  }
}

export async function deleteConversation(
  admin: SupabaseClient,
  principal: AnalystPrincipal,
  id: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('analyst_conversations')
    .delete()
    .eq('id', id)
    .eq('fund_id', principal.fundId)
    .eq('user_id', principal.userId)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return !!data
}

export function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(message => {
    if (!message || typeof message !== 'object') return []
    const item = message as { role?: unknown; content?: unknown }
    if (item.role !== 'user' && item.role !== 'assistant') return []
    if (typeof item.content !== 'string') return []
    return [{ role: item.role, content: item.content.slice(0, 10_000) }]
  })
}

