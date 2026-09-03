import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PostmarkPayload } from '@/lib/pipeline/processEmail'
import { dbError } from '@/lib/api-error'

/**
 * Inbound emails the router matched to this deal and that are waiting for a
 * human to accept them into the data room.
 *
 * Drives the "N emails waiting" tray in the deal room. Each entry carries enough
 * to decide without opening the email: who sent it, the subject, a body preview,
 * and the attachment list (so the reviewer can pick which files to take).
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  const fundId = (membership as any).fund_id as string

  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await admin
    .from('inbound_emails')
    .select('id, subject, from_address, received_at, raw_payload, routing_confidence, routing_reasoning')
    .eq('fund_id', fundId)
    .eq('diligence_deal_id', params.id)
    .eq('diligence_intake_status', 'pending')
    .order('received_at', { ascending: false })
    .limit(50)

  if (error) return dbError(error, 'diligence-email-intake')

  const emails = ((data as any[]) ?? []).map(row => {
    const payload = (row.raw_payload ?? {}) as PostmarkPayload
    const bodyText = payload.TextBody || stripHtml(payload.HtmlBody ?? '')
    return {
      id: row.id,
      subject: row.subject,
      from_address: row.from_address,
      received_at: row.received_at,
      confidence: row.routing_confidence,
      reasoning: row.routing_reasoning,
      body_preview: bodyText.slice(0, 400),
      attachments: (payload.Attachments ?? []).map((a, index) => ({
        index,
        name: a.Name,
        content_type: a.ContentType,
        size_bytes: a.ContentLength ?? 0,
      })),
    }
  })

  return NextResponse.json({ emails, count: emails.length })
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
