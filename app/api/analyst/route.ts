import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { runAnalyst } from '@/lib/ai/analyst/orchestrator'
import { resolveAnalystPrincipal } from '@/lib/ai/analyst/request-context'
import {
  AnalystRequestError,
  type AnalystDocument,
  type AnalystDomain,
} from '@/lib/ai/analyst/types'
import type { ChatMessage } from '@/lib/ai/types'

interface LegacyAnalystBody {
  messages?: ChatMessage[]
  companyId?: string
  dealId?: string
  vehicle?: string
  document?: AnalystDocument
  domain?: AnalystDomain
  model?: { id: string; provider: string }
  conversationId?: string
}

/** Cookie-authenticated web adapter over the shared, transport-neutral Analyst service. */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `ai-analyst:${user.id}`, limit: 30, windowSeconds: 300 })
  if (limited) return limited

  let body: LegacyAnalystBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages array is required' }, { status: 400 })
  }

  const admin = createAdminClient()
  try {
    const principal = await resolveAnalystPrincipal(admin, user.id)
    if (!principal) return NextResponse.json({ error: 'No fund found' }, { status: 404 })

    const result = await runAnalyst(principal, {
      messages: body.messages,
      conversationId: body.conversationId,
      scope: {
        companyId: body.companyId,
        dealId: body.dealId,
        vehicle: body.vehicle,
        domain: body.domain,
      },
      model: body.model,
      document: body.document,
    }, {
      admin,
      isRateLimited: async spec => !!(await rateLimit(spec)),
    })

    // Preserve the web contract while extending it with safely ignorable versioned blocks.
    return NextResponse.json({
      reply: result.reply,
      // Which model actually answered (Auto resolves server-side), for the transcript's meta line.
      model: result.usage ? { id: result.usage.model, provider: result.usage.provider } : null,
      conversationId: result.conversationId,
      proposals: result.proposals,
      vehicle: result.vehicle,
      scope: result.scope,
      toolCalls: result.toolCalls,
      stagedActions: result.stagedActions.map(action => ({
        id: action.id,
        actionType: action.actionType,
        preview: action.preview,
      })),
      blocks: result.blocks,
    })
  } catch (error) {
    if (error instanceof AnalystRequestError) {
      const headers = error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : undefined
      return NextResponse.json({ error: error.message }, { status: error.status, headers })
    }
    console.error('[analyst] request failed:', error)
    return NextResponse.json(
      { error: 'Analyst request failed. Check your API key in Settings.' },
      { status: 500 },
    )
  }
}
