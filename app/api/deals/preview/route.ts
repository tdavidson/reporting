import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createFundAIProvider } from '@/lib/ai'
import { analyzeDeal, DEFAULT_SCREENING_PROMPT } from '@/lib/claude/analyzeDeal'

const SAMPLE_EMAIL = {
  subject: 'Intro: Stellate (Series A Pitch)',
  body: `Hi team —

Reaching out about Stellate, a developer infrastructure startup I co-founded with two ex-Vercel engineers. We help SaaS teams cut their cloud bill by 30-40% via real-time edge caching of database queries. Currently at $1.2M ARR, growing 25% MoM, with 47 paying customers including Notion and Linear.

We're raising a $5M Series A at a $45M post. Lead would be ideal.

Would love to chat if it sounds interesting.

— Alex Chen
CEO & Co-founder, Stellate
alex@stellate.dev
https://stellate.dev`,
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if ((membership as any).role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const thesis = typeof body.thesis === 'string' ? body.thesis : ''
  const screeningPrompt = typeof body.screeningPrompt === 'string' && body.screeningPrompt.trim()
    ? body.screeningPrompt
    : DEFAULT_SCREENING_PROMPT

  const { provider, model, providerType } = await createFundAIProvider(admin, membership.fund_id)

  const analysis = await analyzeDeal({
    emailSubject: SAMPLE_EMAIL.subject,
    emailBody: SAMPLE_EMAIL.body,
    combinedAttachmentText: '',
    pdfBase64s: [],
    images: [],
    thesis,
    screeningPrompt,
    provider,
    providerType,
    model,
    log: { admin, fundId: membership.fund_id },
  })

  return NextResponse.json({ analysis, sample: SAMPLE_EMAIL })
}
