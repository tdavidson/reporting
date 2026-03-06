import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createFundAIProviderWithOverride } from '@/lib/ai'
import type { ChatMessage } from '@/lib/ai/types'
import type { Json } from '@/lib/types/database'
import { logAIUsage } from '@/lib/ai/usage'
import { buildCompanyContext, buildPortfolioContext } from '@/lib/ai/context-builder'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `ai-analyst:${user.id}`, limit: 30, windowSeconds: 300 })
  if (limited) return limited

  let body: {
    messages?: ChatMessage[]
    companyId?: string
    model?: { id: string; provider: string }
    conversationId?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages array is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 404 })

  // Build a case-insensitive lookup map of company names/aliases → company IDs
  const { data: allFundCompanies } = await admin
    .from('companies')
    .select('id, name, aliases')
    .eq('fund_id', membership.fund_id)

  const companyNameLookup = new Map<string, string>()
  const companyIdToName = new Map<string, string>()
  if (allFundCompanies) {
    for (const c of allFundCompanies) {
      companyIdToName.set(c.id, c.name)
      if (c.name && c.name.length > 2) {
        companyNameLookup.set(c.name.toLowerCase(), c.id)
      }
      if (c.aliases) {
        for (const alias of c.aliases) {
          if (alias && alias.length > 2) {
            companyNameLookup.set(alias.toLowerCase(), c.id)
          }
        }
      }
    }
  }

  let systemPrompt: string

  if (body.companyId) {
    // Verify company belongs to fund
    const { data: companyCheck } = await admin
      .from('companies')
      .select('fund_id')
      .eq('id', body.companyId)
      .maybeSingle()

    if (!companyCheck) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (companyCheck.fund_id !== membership.fund_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const ctx = await buildCompanyContext(admin, body.companyId)
    if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    systemPrompt = ctx.systemPrompt
    systemPrompt += `\n\nYou are the Analyst for this portfolio company. Answer questions using the data provided below. Reference specific numbers and dates. Do not perform new calculations — only reference pre-computed data. You can also draft or refine company summaries when asked.\n\nKeep responses concise and analytical. Use plain text (no markdown formatting).`

    if (ctx.metricsBlock) systemPrompt += `\n\n=== QUANTITATIVE DATA ===\n${ctx.metricsBlock}`
    if (ctx.reportContentBlock) systemPrompt += `\n\n=== LATEST REPORT CONTENT ===\n${ctx.reportContentBlock}`
    if (ctx.previousSummariesBlock) systemPrompt += `\n\n=== PREVIOUS SUMMARIES ===\n${ctx.previousSummariesBlock}`
    if (ctx.documentsBlock) systemPrompt += `\n\n=== DOCUMENTS ===\n${ctx.documentsBlock}`
    if (ctx.investmentBlock) systemPrompt += `\n\n=== INVESTMENT DATA ===\n${ctx.investmentBlock}`
    if (ctx.portfolioBlock) systemPrompt += `\n\n=== PORTFOLIO PEERS (for comparison) ===\n${ctx.portfolioBlock}`
    if (ctx.teamNotesBlock) systemPrompt += `\n\n=== TEAM DISCUSSION NOTES ===\nRecent internal team notes and discussions about this company:\n${ctx.teamNotesBlock}`
  } else {
    const ctx = await buildPortfolioContext(admin, membership.fund_id)
    systemPrompt = ctx.systemPrompt
    if (ctx.portfolioBlock) systemPrompt += `\n\n=== PORTFOLIO DATA ===\n${ctx.portfolioBlock}`
    if (ctx.teamNotesBlock) systemPrompt += `\n\n=== TEAM DISCUSSION NOTES ===\nRecent internal team notes and discussions across the portfolio:\n${ctx.teamNotesBlock}`
    systemPrompt += `\n\nIf detailed data about a specific company is included below in a "REFERENCED COMPANY" section, use that data to answer questions about that company.`
  }

  // Dynamic context: detect company references in messages and inject their data
  const referencedCompanyIds = detectReferencedCompanies(
    body.messages,
    companyNameLookup,
    body.companyId ?? null
  )

  if (referencedCompanyIds.length > 0) {
    // Tighter rate limit for cross-company lookups (heavier DB load)
    const crossCompanyLimit = await rateLimit({
      key: `ai-analyst-xref:${user.id}`,
      limit: 10,
      windowSeconds: 300,
    })
    if (crossCompanyLimit) return crossCompanyLimit

    const refContexts = await Promise.all(
      referencedCompanyIds.map(id => buildCompanyContext(admin, id))
    )
    for (const refCtx of refContexts) {
      if (!refCtx) continue
      const name = refCtx.company.name
      let block = `\n\n=== REFERENCED COMPANY: ${name} ===\n(This data was loaded because the user mentioned this company. Use it to answer their question.)`
      if (refCtx.metricsBlock) block += `\n\nMetrics:\n${refCtx.metricsBlock}`
      if (refCtx.investmentBlock) block += `\n\nInvestment data:\n${refCtx.investmentBlock}`
      if (refCtx.reportContentBlock) block += `\n\nLatest report:\n${refCtx.reportContentBlock}`
      if (refCtx.documentsBlock) block += `\n\nDocuments:\n${refCtx.documentsBlock}`
      systemPrompt += block
    }
  }

  // Memory injection: fetch recent conversation summaries from same scope
  try {
    let memoryQuery = admin
      .from('analyst_conversations')
      .select('title, summary')
      .eq('fund_id', membership.fund_id)
      .eq('user_id', user.id)
      .not('summary', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(5)

    if (body.companyId) {
      memoryQuery = memoryQuery.eq('company_id', body.companyId)
    } else {
      memoryQuery = memoryQuery.is('company_id', null)
    }

    // Exclude current conversation from memory
    if (body.conversationId) {
      memoryQuery = memoryQuery.neq('id', body.conversationId)
    }

    const { data: pastConversations } = await memoryQuery

    if (pastConversations && pastConversations.length > 0) {
      const memoryBlock = pastConversations
        .map((c, i) => `${i + 1}. [${c.title}] ${c.summary}`)
        .join('\n')
      systemPrompt += `\n\n=== PREVIOUS CONVERSATION MEMORY ===\nRecent discussions with this user (for context continuity):\n${memoryBlock}`
    }
  } catch {
    // Non-critical — continue without memory
  }

  // AI provider — use override if specified, otherwise fund default
  const providerOverride = body.model?.provider
  let provider: Awaited<ReturnType<typeof createFundAIProviderWithOverride>>['provider']
  let aiModel: string
  let aiProviderType: string
  try {
    const result = await createFundAIProviderWithOverride(admin, membership.fund_id, providerOverride)
    provider = result.provider
    aiModel = body.model?.id ?? result.model
    aiProviderType = result.providerType
  } catch {
    return NextResponse.json({
      error: 'AI API key not configured. Add one in Settings.',
    }, { status: 400 })
  }

  const messages: ChatMessage[] = body.messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 10_000),
  }))

  try {
    const { text, usage } = await provider.createChat({
      model: aiModel,
      maxTokens: 2000,
      system: systemPrompt,
      messages,
    })

    logAIUsage(admin, {
      fundId: membership.fund_id,
      userId: user.id,
      provider: aiProviderType,
      model: aiModel,
      feature: 'analyst',
      usage,
    })

    // Persist conversation
    let conversationId = body.conversationId ?? null
    const lastUserMsg = body.messages[body.messages.length - 1]
    const allMessages = [...body.messages, { role: 'assistant' as const, content: text }]

    try {
      if (conversationId) {
        // Update existing conversation
        await admin
          .from('analyst_conversations')
          .update({
            messages: allMessages as unknown as Json,
            message_count: allMessages.length,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversationId)
          .eq('user_id', user.id)
      } else {
        // Create new conversation with title from first message
        const title = (lastUserMsg?.content ?? 'New conversation').slice(0, 60)

        const { data: newConv } = await admin
          .from('analyst_conversations')
          .insert({
            fund_id: membership.fund_id,
            user_id: user.id,
            company_id: body.companyId ?? null,
            title,
            messages: allMessages as unknown as Json,
            message_count: allMessages.length,
          })
          .select('id')
          .single()

        if (newConv) {
          conversationId = newConv.id

          // Fire-and-forget: summarize previous unsummarized conversation
          summarizePreviousConversation(
            admin,
            provider,
            aiModel,
            membership.fund_id,
            user.id,
            body.companyId ?? null,
            conversationId,
          ).catch(() => {})
        }
      }
    } catch {
      // Non-critical — response still succeeds
    }

    return NextResponse.json({ reply: text, conversationId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[analyst] AI error:', message, err)
    return NextResponse.json({
      error: `Analyst request failed: ${message}`,
    }, { status: 500 })
  }
}

async function summarizePreviousConversation(
  admin: ReturnType<typeof createAdminClient>,
  provider: Awaited<ReturnType<typeof createFundAIProviderWithOverride>>['provider'],
  model: string,
  fundId: string,
  userId: string,
  companyId: string | null,
  excludeConvId: string,
) {
  // Find most recent unsummarized conversation in same scope
  let query = admin
    .from('analyst_conversations')
    .select('id, messages')
    .eq('fund_id', fundId)
    .eq('user_id', userId)
    .is('summary', null)
    .neq('id', excludeConvId)
    .gt('message_count', 0)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (companyId) {
    query = query.eq('company_id', companyId)
  } else {
    query = query.is('company_id', null)
  }

  const { data } = await query
  if (!data || data.length === 0) return

  const conv = data[0]
  const msgs = conv.messages as Array<{ role: string; content: string }>
  if (!Array.isArray(msgs) || msgs.length === 0) return

  // Build condensed transcript (each message truncated to 500 chars, total 4000 chars)
  let transcript = ''
  for (const m of msgs) {
    const line = `${m.role}: ${String(m.content).slice(0, 500)}\n`
    if (transcript.length + line.length > 4000) break
    transcript += line
  }

  try {
    const { text: summary } = await provider.createChat({
      model,
      maxTokens: 300,
      system: 'You are a concise summarizer.',
      messages: [
        {
          role: 'user',
          content: `Summarize this analyst conversation in 2-3 sentences. Focus on key questions, conclusions, and concerns raised.\n\n${transcript}`,
        },
      ],
    })

    await admin
      .from('analyst_conversations')
      .update({ summary })
      .eq('id', conv.id)
  } catch {
    // Summarization is best-effort
  }
}

function detectReferencedCompanies(
  messages: ChatMessage[],
  lookup: Map<string, string>,
  currentCompanyId: string | null
): string[] {
  // Concatenate user messages in reverse order so recent mentions win
  const userTexts: string[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userTexts.push(String(messages[i].content))
    }
  }
  const combined = userTexts.join(' ').toLowerCase()

  const matched = new Map<string, number>() // companyId → earliest position in combined text

  lookup.forEach((companyId, name) => {
    if (currentCompanyId && companyId === currentCompanyId) return
    if (matched.has(companyId)) return

    // Word-boundary match to avoid partial matches
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'i')
    const match = regex.exec(combined)
    if (match) {
      matched.set(companyId, match.index)
    }
  })

  // Sort by position (earliest in combined = most recently mentioned, since we reversed)
  return Array.from(matched.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([id]) => id)
}
