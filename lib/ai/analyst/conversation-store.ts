import type { SupabaseClient } from '@supabase/supabase-js'
import type { AIProvider, ChatMessage } from '@/lib/ai/types'
import type { Json } from '@/lib/types/database'
import type { AnalystPrincipal } from './types'

export interface ConversationCoordinates {
  companyId: string | null
  dealId: string | null
  scope: string | null
}

function applyCoordinates(query: any, coordinates: ConversationCoordinates): any {
  if (coordinates.dealId) return query.eq('deal_id', coordinates.dealId)
  if (coordinates.companyId) return query.eq('company_id', coordinates.companyId).is('deal_id', null)
  query = query.is('company_id', null).is('deal_id', null)
  return coordinates.scope ? query.eq('scope', coordinates.scope) : query.is('scope', null)
}

/** Reject a client-supplied conversation id unless it belongs to this exact user and fund. */
export async function conversationBelongsToPrincipal(
  admin: SupabaseClient,
  principal: AnalystPrincipal,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('analyst_conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('fund_id', principal.fundId)
    .eq('user_id', principal.userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return !!data
}

export async function loadConversationMemory(
  admin: SupabaseClient,
  principal: AnalystPrincipal,
  coordinates: ConversationCoordinates,
  excludeConversationId?: string,
): Promise<string> {
  try {
    let query: any = admin
      .from('analyst_conversations')
      .select('title, summary')
      .eq('fund_id', principal.fundId)
      .eq('user_id', principal.userId)
      .not('summary', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(5)
    query = applyCoordinates(query, coordinates)
    if (excludeConversationId) query = query.neq('id', excludeConversationId)

    const { data } = await query
    if (!data?.length) return ''
    return data.map((conversation: { title: string; summary: string }, index: number) =>
      `${index + 1}. [${conversation.title}] ${conversation.summary}`,
    ).join('\n')
  } catch {
    return ''
  }
}

export async function persistConversation(args: {
  admin: SupabaseClient
  principal: AnalystPrincipal
  coordinates: ConversationCoordinates
  conversationId?: string
  messages: ChatMessage[]
  reply: string
  provider: AIProvider
  model: string
}): Promise<string | null> {
  const { admin, principal, coordinates } = args
  const allMessages = [...args.messages, { role: 'assistant' as const, content: args.reply }]
  try {
    if (args.conversationId) {
      await admin
        .from('analyst_conversations')
        .update({
          messages: allMessages as unknown as Json,
          message_count: allMessages.length,
          updated_at: new Date().toISOString(),
        })
        .eq('id', args.conversationId)
        .eq('fund_id', principal.fundId)
        .eq('user_id', principal.userId)
      return args.conversationId
    }

    const lastUserMessage = args.messages[args.messages.length - 1]
    const { data: created } = await admin
      .from('analyst_conversations')
      .insert({
        fund_id: principal.fundId,
        user_id: principal.userId,
        company_id: coordinates.companyId,
        deal_id: coordinates.dealId,
        scope: coordinates.scope,
        title: (lastUserMessage?.content ?? 'New conversation').slice(0, 60),
        messages: allMessages as unknown as Json,
        message_count: allMessages.length,
      })
      .select('id')
      .single()

    if (!created) return null
    summarizePreviousConversation({
      admin,
      provider: args.provider,
      model: args.model,
      principal,
      coordinates,
      excludeConversationId: created.id,
    }).catch(() => {})
    return created.id
  } catch {
    // Conversation storage is non-critical to answering the current question.
    return args.conversationId ?? null
  }
}

async function summarizePreviousConversation(args: {
  admin: SupabaseClient
  provider: AIProvider
  model: string
  principal: AnalystPrincipal
  coordinates: ConversationCoordinates
  excludeConversationId: string
}): Promise<void> {
  let query: any = args.admin
    .from('analyst_conversations')
    .select('id, messages')
    .eq('fund_id', args.principal.fundId)
    .eq('user_id', args.principal.userId)
    .is('summary', null)
    .neq('id', args.excludeConversationId)
    .gt('message_count', 0)
    .order('updated_at', { ascending: false })
    .limit(1)
  query = applyCoordinates(query, args.coordinates)

  const { data } = await query
  if (!data?.length) return
  const conversation = data[0]
  const messages = conversation.messages as Array<{ role: string; content: string }>
  if (!Array.isArray(messages) || messages.length === 0) return

  let transcript = ''
  for (const message of messages) {
    const line = `${message.role}: ${String(message.content).slice(0, 500)}\n`
    if (transcript.length + line.length > 4000) break
    transcript += line
  }

  try {
    const { text: summary } = await args.provider.createChat({
      model: args.model,
      maxTokens: 300,
      system: 'You are a concise summarizer.',
      messages: [{
        role: 'user',
        content: `Summarize this analyst conversation in 2-3 sentences. Focus on key questions, conclusions, and concerns raised.\n\n${transcript}`,
      }],
    })
    await args.admin.from('analyst_conversations').update({ summary }).eq('id', conversation.id)
  } catch {
    // Best effort only.
  }
}
