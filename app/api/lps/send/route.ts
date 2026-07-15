import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveLpRecipients } from '@/lib/lp-recipients'
import { getOutboundConfig, sendOutboundEmail, type EmailAttachment } from '@/lib/email'
import { generateInvestorReportPdf, generateLetterPdf } from '@/lib/lp-report-pdf'

export const maxDuration = 300

type Kind = 'snapshot' | 'letter' | 'document'
type Delivery = 'link' | 'attachment' | 'both'

// Each snapshot attachment spins up its own headless Chrome, so keep this low to
// avoid exhausting serverless memory; link-only sends are just API calls.
const SEND_CONCURRENCY = 3

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildHtml(opts: { fundName: string; message: string; link: string | null; itemTitle: string }): string {
  const { fundName, message, link, itemTitle } = opts
  const body = esc(message).replace(/\r?\n/g, '<br>')
  const button = link
    ? `<table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;"><tr><td style="background-color:#111827;border-radius:6px;padding:12px 24px;">
        <a href="${esc(link)}" style="color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;display:inline-block;">View in your portal</a>
      </td></tr></table>
      <p style="margin:0 0 24px 0;font-size:12px;color:#6b7280;word-break:break-all;">Or copy this link: ${esc(link)}</p>`
    : ''
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
        <tr><td style="padding:32px 32px 0 32px;">
          <p style="margin:0;font-size:13px;color:#6b7280;">${esc(fundName)}</p>
        </td></tr>
        <tr><td style="padding:20px 32px 32px 32px;">
          <h1 style="margin:0 0 16px 0;font-size:20px;font-weight:600;color:#111827;">${esc(itemTitle)}</h1>
          <div style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#374151;">${body}</div>
          ${button}
          <p style="margin:0;font-size:12px;color:#9ca3af;">If you weren't expecting this email, you can safely ignore it.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:11px;color:#9ca3af;">Sent by ${esc(fundName)} via their reporting portal.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0
  const runner = async () => { while (cursor < items.length) await worker(items[cursor++]) }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner))
}

type ResolvedItem = {
  itemTitle: string
  link: string
  sharedInvestorIds: string[] // every investor the item is shared with (fund-wide docs => all fund investors)
  docRow: { storage_path: string; mime_type: string | null; file_name: string } | null
}

/**
 * Resolve an LP item within the caller's fund and the full set of investors it's
 * shared with. Returns an error response if the item isn't in this fund. Shared
 * by GET (recipient list) and POST (send) so both agree on eligibility.
 */
async function resolveSendItem(admin: any, fundId: string, siteUrl: string, kind: Kind, id: string): Promise<ResolvedItem | { error: NextResponse }> {
  if (kind === 'snapshot') {
    const { data: snap } = await admin.from('lp_snapshots').select('id, name').eq('id', id).eq('fund_id', fundId).maybeSingle()
    if (!snap) return { error: NextResponse.json({ error: 'Snapshot not found' }, { status: 404 }) }
    const { data: shares } = await admin.from('lp_snapshot_shares').select('lp_investor_id').eq('snapshot_id', id).eq('fund_id', fundId)
    return { itemTitle: snap.name || 'Statement', link: `${siteUrl}/portal/snapshots/${id}`, sharedInvestorIds: Array.from(new Set((shares ?? []).map((s: any) => s.lp_investor_id as string))), docRow: null }
  }
  if (kind === 'letter') {
    const { data: letter } = await admin.from('lp_letters').select('id, period_label, status').eq('id', id).eq('fund_id', fundId).maybeSingle()
    if (!letter) return { error: NextResponse.json({ error: 'Letter not found' }, { status: 404 }) }
    if (letter.status === 'generating') return { error: NextResponse.json({ error: 'Letter is still generating' }, { status: 400 }) }
    const { data: shares } = await admin.from('lp_letter_shares').select('lp_investor_id').eq('letter_id', id).eq('fund_id', fundId)
    return { itemTitle: letter.period_label || 'Letter', link: `${siteUrl}/portal/letters/${id}`, sharedInvestorIds: Array.from(new Set((shares ?? []).map((s: any) => s.lp_investor_id as string))), docRow: null }
  }
  const { data: doc } = await admin.from('lp_documents').select('id, title, file_name, storage_path, mime_type, scope').eq('id', id).eq('fund_id', fundId).maybeSingle()
  if (!doc) return { error: NextResponse.json({ error: 'Document not found' }, { status: 404 }) }
  const docRow = { storage_path: doc.storage_path, mime_type: doc.mime_type, file_name: doc.file_name }
  let sharedInvestorIds: string[]
  if (doc.scope === 'fund') {
    // Fund-wide doc: every investor in the fund can see it.
    const { data: invs } = await admin.from('lp_investors').select('id').eq('fund_id', fundId)
    sharedInvestorIds = (invs ?? []).map((r: any) => r.id as string)
  } else {
    const { data: shares } = await admin.from('lp_document_shares').select('lp_investor_id').eq('document_id', id)
    sharedInvestorIds = Array.from(new Set((shares ?? []).map((s: any) => s.lp_investor_id as string)))
  }
  return { itemTitle: doc.title || doc.file_name, link: `${siteUrl}/portal/snapshots`, sharedInvestorIds, docRow }
}

/**
 * Admin-only: the investors an item is shared with (i.e. the valid send
 * recipients), so the GP dialog can show checkboxes for exactly those LPs.
 *
 * GET ?kind=&id=  →  { portalEnabled, itemTitle, investors: [{ id, name }] }
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  const fundId = writeCheck.fundId

  const sp = new URL(req.url).searchParams
  const kind = sp.get('kind') as Kind
  const id = sp.get('id') ?? ''
  if (!['snapshot', 'letter', 'document'].includes(kind) || !id) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const resolved = await resolveSendItem(admin, fundId, siteUrl, kind, id)
  if ('error' in resolved) return resolved.error

  const { data: fs } = await (admin as any).from('fund_settings').select('lp_portal_enabled').eq('fund_id', fundId).maybeSingle()
  let investors: { id: string; name: string }[] = []
  if (resolved.sharedInvestorIds.length) {
    const { data: invs } = await (admin as any).from('lp_investors').select('id, name').eq('fund_id', fundId).in('id', resolved.sharedInvestorIds)
    investors = (invs ?? []).map((r: any) => ({ id: r.id, name: r.name }))
  }
  return NextResponse.json({ portalEnabled: !!fs?.lp_portal_enabled, itemTitle: resolved.itemTitle, investors })
}

/**
 * Admin-only: email an LP-portal item (snapshot / letter / uploaded document) to
 * selected LPs. Authorized users delegated under each LP are Cc'd automatically.
 * Recipients are restricted to investors the item is actually shared with, so we
 * never email someone a link they can't open.
 *
 * POST { kind, id, lp_investor_ids: string[], subject, message, delivery }
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  const fundId = writeCheck.fundId

  const body = await req.json().catch(() => ({}))
  const kind = body.kind as Kind
  const id = typeof body.id === 'string' ? body.id : ''
  const delivery = (['link', 'attachment', 'both'].includes(body.delivery) ? body.delivery : 'link') as Delivery
  const requested: string[] = Array.isArray(body.lp_investor_ids)
    ? body.lp_investor_ids.filter((x: unknown): x is string => typeof x === 'string')
    : []
  const message = typeof body.message === 'string' ? body.message : ''
  let subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : ''
  if (!['snapshot', 'letter', 'document'].includes(kind) || !id) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (requested.length === 0) return NextResponse.json({ error: 'Select at least one LP' }, { status: 400 })

  const { data: fund } = await admin.from('funds').select('name').eq('id', fundId).maybeSingle()
  const fundName = fund?.name || 'Your fund'
  const { data: fs } = await (admin as any).from('fund_settings').select('lp_portal_enabled').eq('fund_id', fundId).maybeSingle()
  const portalEnabled = !!fs?.lp_portal_enabled

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // Resolve the item (verifies fund ownership) and intersect the investors it's
  // shared with against the ones the GP selected.
  const resolved = await resolveSendItem(admin, fundId, siteUrl, kind, id)
  if ('error' in resolved) return resolved.error
  const { itemTitle, link, docRow } = resolved
  const requestedSet = new Set(requested)
  const sharedInvestorIds = resolved.sharedInvestorIds.filter(x => requestedSet.has(x))

  if (!portalEnabled && delivery !== 'attachment') {
    return NextResponse.json({ error: 'The LP portal is off, so portal links won\'t work. Enable it in Settings, or send as a PDF attachment instead.' }, { status: 400 })
  }
  if (sharedInvestorIds.length === 0) {
    return NextResponse.json({ error: 'None of the selected LPs have access to this item. Share it with them first.' }, { status: 400 })
  }

  const groups = await resolveLpRecipients(admin, fundId, sharedInvestorIds)
  if (groups.length === 0) {
    return NextResponse.json({ error: 'The selected LPs don\'t have portal accounts yet. Invite them from Settings → LP access.' }, { status: 400 })
  }

  const config = await getOutboundConfig(admin, fundId)
  if (!config) return NextResponse.json({ error: 'No outbound email provider is configured for this fund.' }, { status: 400 })

  if (!subject) subject = `${fundName}: ${itemTitle}`
  const wantsAttachment = delivery === 'attachment' || delivery === 'both'
  const emailLink = delivery === 'attachment' ? null : link

  // Preview mode: return exactly who would be emailed (To + auto-Cc addresses) and the rendered
  // email, WITHOUT sending. This is the review step the GP confirms before anything goes out.
  if (body.preview === true) {
    return NextResponse.json({
      preview: true,
      subject,
      itemTitle,
      fromName: fundName,
      html: buildHtml({ fundName, message, link: emailLink, itemTitle }),
      attachment: wantsAttachment,
      recipients: groups.map(g => ({
        to: g.primaryEmail,
        name: g.primaryName,
        cc: g.ccEmails,
        investorCount: g.investorIds.length,
      })),
    })
  }

  // Letter / document attachments are identical for everyone — build once.
  // (Snapshot attachments are built per-recipient inside the loop, scoped to
  // that recipient's investors.) Failures here would otherwise 500 the whole
  // batch, so report them as a clear error instead.
  let sharedAttachment: EmailAttachment | null = null
  if (wantsAttachment && (kind === 'letter' || kind === 'document')) {
    try {
      if (kind === 'letter') {
        const pdf = await generateLetterPdf(admin, { fundId, letterId: id })
        if (pdf) sharedAttachment = { filename: pdf.fileName, content: pdf.pdf, contentType: 'application/pdf' }
      } else if (docRow) {
        const { data: blob } = await (admin as any).storage.from('lp-documents').download(docRow.storage_path)
        if (blob) {
          const buf = Buffer.from(await blob.arrayBuffer())
          sharedAttachment = { filename: docRow.file_name, content: buf, contentType: docRow.mime_type || 'application/octet-stream' }
        }
      }
    } catch (e) {
      console.error('[lps/send] attachment build failed:', (e as Error)?.message)
    }
    if (!sharedAttachment) {
      return NextResponse.json({ error: 'Could not prepare the attachment. Try again, or send a secure link instead.' }, { status: 502 })
    }
  }

  const summary = {
    sent: 0,
    primaryRecipients: groups.length,
    ccRecipients: groups.reduce((a, g) => a + g.ccEmails.length, 0),
    failures: [] as string[],
  }

  await runPool(groups, SEND_CONCURRENCY, async (g) => {
    try {
      const attachments: EmailAttachment[] = []
      if (wantsAttachment) {
        if (kind === 'snapshot') {
          // Snapshot PDFs are scoped to each recipient's own investor slice.
          const pdf = await generateInvestorReportPdf(admin, { fundId, snapshotId: id, investorIds: g.investorIds })
          if (pdf) attachments.push({ filename: pdf.fileName, content: pdf.pdf, contentType: 'application/pdf' })
        } else if (sharedAttachment) {
          attachments.push(sharedAttachment)
        }
        // Attachment-only delivery with nothing to attach would be an empty
        // email — skip it and report the recipient as a failure instead.
        if (delivery === 'attachment' && attachments.length === 0) {
          summary.failures.push(g.primaryEmail)
          return
        }
      }
      await sendOutboundEmail(config, {
        to: g.primaryEmail,
        cc: g.ccEmails.length ? g.ccEmails.join(', ') : undefined,
        subject,
        html: buildHtml({ fundName, message, link: emailLink, itemTitle }),
        attachments: attachments.length ? attachments : undefined,
      })
      summary.sent += 1
    } catch (e) {
      summary.failures.push(g.primaryEmail)
      console.error(`[lps/send] failed for ${g.primaryEmail}:`, (e as Error)?.message)
    }
  })

  return NextResponse.json({ ok: true, ...summary })
}
