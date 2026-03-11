import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import type { ParsingReview, Company, Metric, InboundEmail } from '@/lib/types/database'
import { dbError } from '@/lib/api-error'

type ReviewRow = Pick<
  ParsingReview,
  'id' | 'issue_type' | 'extracted_value' | 'context_snippet' | 'created_at'
> & {
  companies: Pick<Company, 'id' | 'name'> | null
  metrics: Pick<Metric, 'id' | 'name' | 'unit' | 'value_type'> | null
  inbound_emails: Pick<InboundEmail, 'id' | 'subject' | 'received_at' | 'from_address'> | null
}

// GET — returns unresolved reviews for a specific email
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('parsing_reviews')
    .select(`
      id, issue_type, extracted_value, context_snippet, created_at,
      companies ( id, name ),
      metrics ( id, name, unit, value_type ),
      inbound_emails ( id, subject, received_at, from_address )
    `)
    .eq('email_id', params.id)
    .is('resolution', null)
    .order('created_at', { ascending: false })

  if (error) return dbError(error, 'emails-id-reviews')

  const rows = (data ?? []) as unknown as ReviewRow[]

  const items = rows.map(r => ({
    id: r.id,
    issue_type: r.issue_type,
    extracted_value: r.extracted_value,
    context_snippet: r.context_snippet,
    created_at: r.created_at,
    company: r.companies ?? null,
    metric: r.metrics ?? null,
    email: r.inbound_emails ?? null,
  }))

  const counts: Record<string, number> = {}
  for (const item of items) {
    counts[item.issue_type] = (counts[item.issue_type] ?? 0) + 1
  }

  return NextResponse.json({ total: items.length, counts, items })
}

// POST — bulk actions on reviews for an email
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const body = await req.json()
  const { action } = body as { action: string }

  if (action !== 'dismiss_all' && action !== 'approve_all') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const resolution = action === 'approve_all' ? 'accepted' as const : 'rejected' as const

  // Get all unresolved reviews for this email
  const { data: reviews, error } = await supabase
    .from('parsing_reviews')
    .select('id, fund_id')
    .eq('email_id', params.id)
    .is('resolution', null)

  if (error) return dbError(error, 'emails-id-reviews')

  // Get the email's fund_id for settings check
  const { data: emailData } = await admin
    .from('inbound_emails')
    .select('fund_id')
    .eq('id', params.id)
    .single()

  const fundId = (reviews?.[0] as unknown as { fund_id: string })?.fund_id
    ?? (emailData as unknown as { fund_id: string })?.fund_id

  if (reviews && reviews.length > 0) {
    const reviewIds = reviews.map(r => (r as unknown as { id: string }).id)

    // Mark all with the appropriate resolution
    await admin
      .from('parsing_reviews')
      .update({
        resolution,
        resolved_at: new Date().toISOString(),
      })
      .in('id', reviewIds)

    // Check retain setting
    if (fundId) {
      const { data: settingsData } = await admin
        .from('fund_settings')
        .select('retain_resolved_reviews')
        .eq('fund_id', fundId)
        .maybeSingle()

      const settings = settingsData as unknown as { retain_resolved_reviews: boolean } | null
      if (settings && !settings.retain_resolved_reviews) {
        await admin.from('parsing_reviews').delete().in('id', reviewIds)
      }
    }
  }

  // Promote email status to success (scoped to fund)
  if (fundId) {
    await admin
      .from('inbound_emails')
      .update({ processing_status: 'success' })
      .eq('id', params.id)
      .eq('fund_id', fundId)
      .in('processing_status', ['needs_review', 'processing', 'failed'])
  }

  revalidateTag('review-badge')

  return NextResponse.json({ ok: true, resolved: reviews?.length ?? 0 })
}
