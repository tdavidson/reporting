import type { SupabaseClient } from '@supabase/supabase-js'
import { runAnalyst as runAnalystService } from '@/lib/ai/analyst/orchestrator'
import { resolveAnalystPrincipal } from '@/lib/ai/analyst/request-context'
import { AnalystRequestError, type AnalystPrincipal, type AnalystRequest, type AnalystResult } from '@/lib/ai/analyst/types'
import { getConversation } from '@/lib/api-v1/conversations'
import type { ChatMessage } from '@/lib/ai/types'
import { rateLimit as rateLimitService } from '@/lib/rate-limit'
import { sendSms as sendSmsService, type SentMessage, type SmsConfig, type SmsProvider } from './sms-config'

/**
 * A text message as an Analyst turn.
 *
 * The webhook has already done the two things only it can do — resolve the fund from the number
 * that was texted, and verify the provider's signature under that fund's token — and has
 * acknowledged the delivery. Everything from "who is this?" onward happens here, after the
 * response, because an Analyst run with tools takes longer than a webhook is allowed to.
 *
 * WHO IS THIS is answered by analyst_phone_numbers alone: a verified row for this sender in this
 * fund, or nothing. Nothing in the message body can name a user, a fund, or a conversation.
 * From there it is the same path as every other transport: `resolveAnalystPrincipal` for the live
 * membership and grants, `runAnalyst` for the answer, the shared conversation store for memory.
 *
 * Read-only by construction. `allowDrafts` is false, so the model is never offered a write tool:
 * a phone number is a weaker credential than a session (SIM swaps exist), and nothing a text can
 * do should need approving in the web app anyway.
 */

export interface InboundText {
  fundId: string
  config: SmsConfig
  provider: SmsProvider
  /** Sender, E.164. */
  from: string
  body: string
  /** The provider's id for this delivery — the idempotency key for retries. */
  providerMessageId: string | null
  mediaCount?: number
}

export type InboundOutcome =
  | 'duplicate'
  | 'rate_limited'
  | 'unknown_number'
  | 'opted_out'
  | 'command'
  | 'answered'
  | 'failed'

export interface InboundTextDependencies {
  runAnalyst: typeof runAnalystService
  sendSms: (config: SmsConfig, to: string, body: string) => Promise<SentMessage[]>
  /** True means over the limit. */
  isRateLimited: (spec: { key: string; limit: number; windowSeconds: number }) => Promise<boolean>
  now: () => Date
}

const defaultDependencies: InboundTextDependencies = {
  runAnalyst: runAnalystService,
  sendSms: (config, to, body) => sendSmsService(config, to, body),
  isRateLimited: async spec => !!(await rateLimitService(spec)),
  now: () => new Date(),
}

/** A thread older than this starts fresh: yesterday's question is not context for today's. */
export const CONVERSATION_IDLE_MS = 6 * 60 * 60 * 1000
const MAX_INBOUND_CHARS = 1600
const LOGGED_BODY_CHARS = 2000

export const REPLIES = {
  notLinked: 'This number isn\'t linked to an account. In the web app, open Settings → Text the Analyst to link it.',
  help: 'Text me a question about your portfolio, funds, or LPs. Reply NEW to start a fresh conversation, STOP to opt out.',
  started: 'Started a new conversation. What would you like to know?',
  resumed: 'You\'re back on. Text me a question any time.',
  textOnly: 'I can read text only for now — type your question and I\'ll take a look.',
  empty: 'I couldn\'t find an answer to that. Try asking another way.',
  notConfigured: 'The Analyst isn\'t set up yet: an admin needs to add an AI API key in Settings.',
  rateLimited: 'Too many requests right now. Try again in a few minutes.',
  failed: 'Sorry, something went wrong answering that. Try again in a moment.',
} as const

type Command = 'stop' | 'start' | 'help' | 'new'

/** Carrier keywords first (Twilio enforces them on US numbers; the app must honour them too). */
function parseCommand(body: string): Command | null {
  const word = body.trim().toUpperCase().replace(/[.!]+$/, '')
  if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(word)) return 'stop'
  if (['START', 'YES', 'UNSTOP'].includes(word)) return 'start'
  if (['HELP', 'INFO'].includes(word)) return 'help'
  if (['NEW', 'RESET', 'NEW CHAT', 'NEW CONVERSATION', 'START OVER'].includes(word)) return 'new'
  return null
}

interface PhoneRow {
  id: string
  fund_id: string
  user_id: string
  phone_e164: string
  conversation_id: string | null
  last_message_at: string | null
  opted_out_at: string | null
}

export async function handleInboundText(
  admin: SupabaseClient,
  inbound: InboundText,
  overrides: Partial<InboundTextDependencies> = {},
): Promise<InboundOutcome> {
  const deps = { ...defaultDependencies, ...overrides }
  const log = new MessageLog(admin, inbound)

  // Idempotency before anything costs money: a retried webhook is the same message, not a new one.
  if (!(await log.recordInbound())) return 'duplicate'

  // Per-number, before the sender is even looked up: an unlinked number that texts in a loop is
  // as expensive as a linked one, and the bucket is cheap.
  if (await deps.isRateLimited({ key: `sms-analyst:number:${inbound.from}`, limit: 20, windowSeconds: 300 })) {
    await log.markInbound('ignored', 'rate limited')
    return 'rate_limited'
  }

  const { data: phone, error } = await admin
    .from('analyst_phone_numbers')
    .select('id, fund_id, user_id, phone_e164, conversation_id, last_message_at, opted_out_at')
    .eq('fund_id', inbound.fundId)
    .eq('phone_e164', inbound.from)
    .not('verified_at', 'is', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const row = (phone as unknown as PhoneRow | null) ?? null

  if (!row) {
    // Say so once a day per number. A stranger texting the fund's number learns only that they
    // are one; a member who forgot to link learns what to do.
    if (!(await deps.isRateLimited({ key: `sms-analyst:unlinked:${inbound.from}`, limit: 1, windowSeconds: 24 * 3600 }))) {
      await reply(deps, log, inbound, REPLIES.notLinked, null)
    }
    await log.markInbound('ignored', 'number not linked')
    return 'unknown_number'
  }
  log.phoneNumberId = row.id

  const command = parseCommand(inbound.body)
  if (command === 'stop') {
    await update(admin, row.id, { opted_out_at: deps.now().toISOString(), conversation_id: null })
    await log.markInbound('received', 'opted out')
    // Twilio sends the carrier-mandated confirmation itself; a second one from the app is noise.
    return 'command'
  }
  if (row.opted_out_at && command !== 'start') {
    await log.markInbound('ignored', 'opted out')
    return 'opted_out'
  }
  if (command === 'start') {
    await update(admin, row.id, { opted_out_at: null })
    await reply(deps, log, inbound, REPLIES.resumed, null)
    return 'command'
  }
  if (command === 'help') {
    await reply(deps, log, inbound, REPLIES.help, null)
    return 'command'
  }
  if (command === 'new') {
    await update(admin, row.id, { conversation_id: null })
    await reply(deps, log, inbound, REPLIES.started, null)
    return 'command'
  }

  const text = inbound.body.trim().slice(0, MAX_INBOUND_CHARS)
  if (!text) {
    if (inbound.mediaCount) await reply(deps, log, inbound, REPLIES.textOnly, null)
    await log.markInbound('ignored', 'empty body')
    return 'command'
  }

  // Live membership and grants, every message. The row says which user; nothing about what they
  // may see is stored with the number.
  const principal = await resolveAnalystPrincipal(admin, row.user_id)
  if (!principal || principal.fundId !== row.fund_id) {
    await reply(deps, log, inbound, REPLIES.notLinked, null)
    await log.markInbound('ignored', 'no longer a member of this fund')
    return 'unknown_number'
  }

  const history = await continuedConversation(admin, principal, row, deps.now())
  const messages: ChatMessage[] = [...history.messages, { role: 'user', content: text }]

  let result: AnalystResult
  try {
    result = await deps.runAnalyst(principal, smsRequest(messages, history.conversationId), {
      admin,
      isRateLimited: spec => deps.isRateLimited({ ...spec, key: `sms:${principal.fundId}:${spec.key}` }),
    })
  } catch (error) {
    const message = error instanceof AnalystRequestError ? friendlyError(error) : REPLIES.failed
    if (!(error instanceof AnalystRequestError)) console.error('[messaging] Analyst run failed:', error)
    await reply(deps, log, inbound, message, null)
    await log.markInbound('received', error instanceof Error ? error.message : String(error))
    return 'failed'
  }

  await reply(deps, log, inbound, result.reply.trim() || REPLIES.empty, result.conversationId)
  await update(admin, row.id, {
    conversation_id: result.conversationId,
    last_message_at: deps.now().toISOString(),
  })
  await log.markInbound('received', null, result.conversationId)
  return 'answered'
}

function smsRequest(messages: ChatMessage[], conversationId: string | null): AnalystRequest {
  return {
    messages,
    conversationId: conversationId ?? undefined,
    channel: 'sms',
    allowDrafts: false,
  }
}

function friendlyError(error: AnalystRequestError): string {
  switch (error.code) {
    case 'AI_NOT_CONFIGURED': return REPLIES.notConfigured
    case 'RATE_LIMITED': return REPLIES.rateLimited
    default: return REPLIES.failed
  }
}

/**
 * The thread this text continues: the row's conversation when it exists, is still this user's,
 * and was last used recently. Otherwise a fresh one — and the row is not cleared here, because
 * `runAnalyst` will persist a new conversation and the caller stores that id.
 */
async function continuedConversation(
  admin: SupabaseClient,
  principal: AnalystPrincipal,
  row: PhoneRow,
  now: Date,
): Promise<{ conversationId: string | null; messages: ChatMessage[] }> {
  if (!row.conversation_id) return { conversationId: null, messages: [] }
  const last = row.last_message_at ? new Date(row.last_message_at).getTime() : 0
  if (now.getTime() - last > CONVERSATION_IDLE_MS) return { conversationId: null, messages: [] }
  // Scoped to the principal's user AND fund: a conversation that is no longer theirs is one that
  // does not exist.
  const conversation = await getConversation(admin, principal, row.conversation_id)
  if (!conversation) return { conversationId: null, messages: [] }
  return { conversationId: conversation.id, messages: conversation.messages }
}

async function reply(
  deps: InboundTextDependencies,
  log: MessageLog,
  inbound: InboundText,
  body: string,
  conversationId: string | null,
): Promise<void> {
  try {
    const sent = await deps.sendSms(inbound.config, inbound.from, body)
    await log.recordOutbound(sent, conversationId)
  } catch (error) {
    console.error('[messaging] reply failed:', error)
    await log.recordOutboundFailure(body, error instanceof Error ? error.message : String(error), conversationId)
  }
}

async function update(admin: SupabaseClient, id: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await admin
    .from('analyst_phone_numbers')
    .update({ ...values, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
  if (error) console.error('[messaging] phone row update failed:', error.message)
}

/** The delivery log — one inbound row (the idempotency key) and one per outbound piece. */
class MessageLog {
  inboundId: string | null = null
  phoneNumberId: string | null = null

  constructor(private readonly admin: SupabaseClient, private readonly inbound: InboundText) {}

  /** False when this provider message id was already recorded: a retry, not a message. */
  async recordInbound(): Promise<boolean> {
    const { data, error } = await this.admin
      .from('analyst_phone_messages')
      .insert({
        fund_id: this.inbound.fundId,
        direction: 'inbound',
        provider: this.inbound.provider,
        provider_message_id: this.inbound.providerMessageId,
        phone_e164: this.inbound.from,
        body: this.inbound.body.slice(0, LOGGED_BODY_CHARS),
        status: 'received',
      } as never)
      .select('id')
      .maybeSingle()
    if (error) {
      // 23505: the partial unique index on (provider, provider_message_id).
      if ((error as { code?: string }).code === '23505') return false
      throw new Error(error.message)
    }
    this.inboundId = (data as { id: string } | null)?.id ?? null
    return true
  }

  async markInbound(status: 'received' | 'ignored', note: string | null, conversationId: string | null = null): Promise<void> {
    if (!this.inboundId) return
    await this.admin
      .from('analyst_phone_messages')
      .update({
        status,
        error: note,
        phone_number_id: this.phoneNumberId,
        conversation_id: conversationId,
      } as never)
      .eq('id', this.inboundId)
  }

  async recordOutbound(sent: SentMessage[], conversationId: string | null): Promise<void> {
    if (sent.length === 0) return
    await this.admin.from('analyst_phone_messages').insert(sent.map(piece => ({
      fund_id: this.inbound.fundId,
      phone_number_id: this.phoneNumberId,
      direction: 'outbound',
      provider: this.inbound.provider,
      provider_message_id: piece.providerMessageId,
      phone_e164: this.inbound.from,
      body: piece.body.slice(0, LOGGED_BODY_CHARS),
      status: 'sent',
      conversation_id: conversationId,
    })) as never)
  }

  async recordOutboundFailure(body: string, message: string, conversationId: string | null): Promise<void> {
    await this.admin.from('analyst_phone_messages').insert({
      fund_id: this.inbound.fundId,
      phone_number_id: this.phoneNumberId,
      direction: 'outbound',
      provider: this.inbound.provider,
      phone_e164: this.inbound.from,
      body: body.slice(0, LOGGED_BODY_CHARS),
      status: 'failed',
      error: message.slice(0, 500),
      conversation_id: conversationId,
    } as never)
  }
}
