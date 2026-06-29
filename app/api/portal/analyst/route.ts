import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createFundAIProviderWithOverride } from '@/lib/ai'
import { withTopicalGuardrail } from '@/lib/ai/topical-guard'
import type { ChatMessage } from '@/lib/ai/types'
import { logAIUsage } from '@/lib/ai/usage'
import { rateLimit } from '@/lib/rate-limit'
import { resolveLpAccess } from '@/lib/api-helpers'
import { buildLpAnalystContext } from '@/lib/ai/lp-analyst-context'

/**
 * LP-portal AI analyst. Stateless (no stored history). The fund and the LP's
 * investor scope are resolved server-side from the session — never from the
 * request — and the context is restricted to documents/letters/statements
 * shared with THIS investor. Cross-tenant access is impossible by construction.
 */

async function lpFundId(admin: any, investorIds: string[]): Promise<string | null> {
  if (!investorIds.length) return null
  const { data } = await admin.from('lp_investors').select('fund_id').in('id', investorIds).limit(1).maybeSingle()
  return data?.fund_id ?? null
}

// GET → { available }: whether the LP can use the analyst (their fund has AI configured). Gates the UI.
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ available: false })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse || !access.investorIds.length) return NextResponse.json({ available: false })

  const fundId = await lpFundId(admin, access.investorIds)
  if (!fundId) return NextResponse.json({ available: false })

  try {
    await createFundAIProviderWithOverride(admin, fundId)
    return NextResponse.json({ available: true })
  } catch {
    return NextResponse.json({ available: false })
  }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `lp-analyst:${user.id}`, limit: 20, windowSeconds: 300 })
  if (limited) return limited

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  if (!access.investorIds.length) return NextResponse.json({ error: 'No portal access' }, { status: 403 })

  const fundId = await lpFundId(admin, access.investorIds)
  if (!fundId) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  let body: { messages?: ChatMessage[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages array is required' }, { status: 400 })
  }

  const ctx = await buildLpAnalystContext(admin, fundId, access.investorIds)

  let systemPrompt = `You are the investor assistant in a fund's investor portal, speaking with a limited partner (LP). Answer ONLY from the materials below — the documents, letters, and statement figures the fund has shared with THIS investor. If the answer isn't in those materials, say you don't have that information and suggest they contact the fund directly. Never mention or infer anything about other investors. Reference specific figures and dates when relevant. Be concise and clear. Use plain text (no markdown).`
  if (ctx.statementsBlock) systemPrompt += `\n\n=== YOUR STATEMENT FIGURES ===\n${ctx.statementsBlock}`
  if (ctx.lettersBlock) systemPrompt += `\n\n=== LETTERS SHARED WITH YOU ===\n${ctx.lettersBlock}`
  if (ctx.documentsBlock) systemPrompt += `\n\n=== DOCUMENTS SHARED WITH YOU ===\n${ctx.documentsBlock}`
  if (!ctx.hasContent) systemPrompt += `\n\n(Nothing has been shared with you yet, so there are no materials to reference. Let them know and suggest contacting the fund.)`

  let provider: Awaited<ReturnType<typeof createFundAIProviderWithOverride>>['provider']
  let aiModel: string
  let aiProviderType: string
  try {
    const result = await createFundAIProviderWithOverride(admin, fundId)
    provider = result.provider
    aiModel = result.model
    aiProviderType = result.providerType
  } catch {
    return NextResponse.json({ error: 'The assistant is not enabled for your fund.' }, { status: 400 })
  }

  const messages: ChatMessage[] = body.messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 10_000),
  }))

  try {
    const { text, usage } = await provider.createChat({
      model: aiModel,
      maxTokens: 1500,
      system: withTopicalGuardrail(systemPrompt),
      messages,
    })
    logAIUsage(admin, { fundId, userId: user.id, provider: aiProviderType, model: aiModel, feature: 'lp-analyst', usage })
    return NextResponse.json({ reply: text })
  } catch {
    return NextResponse.json({ error: 'The assistant is unavailable right now. Please try again.' }, { status: 500 })
  }
}
