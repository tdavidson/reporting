// Notices: from a register row to a PDF in each partner's portal, and from there to their inbox.
//
// Two steps, deliberately. PUBLISHING renders one notice per partner from the frozen register line
// and files it in their portal as a document; it is idempotent, because the line remembers the
// document it produced and a second publish reuses it rather than filing a copy. EMAILING sends
// that document (as a portal link, an attachment, or both) to the partner's account and the
// authorized users under it, and writes a delivery-log row per send. A GP can do either alone or
// both in one action; the route composes them.
//
// Every figure comes from the REGISTER, never recomputed: the 1300 receivable and the 2300 payable
// both decay as money moves, so deriving a notice from the ledger would restate what a partner was
// told every time somebody paid.

import type { SupabaseClient } from '@supabase/supabase-js'
import { runPool } from '@/lib/lp-report-pdf'
import { generateNoticePdf, type NoticeKind } from './notice-pdf'
import { lpCapitalSummary } from './capital-calls'
import { loadEntityNames } from './load'
import { vehicleIdByName } from './vehicle-id'
import { displayFontOf } from '@/lib/theme'
import { ACTUAL_BOOK } from './books'
import { loadCapitalSource } from './capital-source'
import { resolveLpRecipients } from '@/lib/lp-recipients'
import { getOutboundConfig, sendOutboundEmail, type EmailAttachment } from '@/lib/email'
import { buildLpEmailHtml, siteUrl } from '@/lib/lp-email'
import { logDelivery } from '@/lib/lp-deliveries'
import { roundCents } from './ledger'

export interface NoticeLine {
  id: string
  lpEntityId: string
  amount: number
  role: 'lp' | 'carry'
  noticeDocumentId: string | null
}

export interface NoticeRegister {
  kind: NoticeKind
  id: string
  noticeDate: string
  description: string | null
  numberLabel: number | null
  dueDate: string | null
  lines: NoticeLine[]
  /** The waterfall tiers, for a distribution declared through one. */
  tiers: { returnOfCapital: number; preferred: number; lpTotal: number } | null
  /** Set when the register has a posted entry behind it (ledger vehicles). */
  posted: boolean
  /** True on a capital-tracking vehicle, where there is no entry to check. */
  tracking: boolean
}

/** The register row a notice is rendered from, or why there is none to render. */
export async function loadNoticeRegister(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  kind: NoticeKind,
  id: string,
): Promise<NoticeRegister | { error: string; status: number }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const tracking = (await loadCapitalSource(admin, fundId, group)) !== 'ledger'

  let row: any
  let entryIds: string[] = []
  if (kind === 'capital_call') {
    const { data } = await admin
      .from('capital_calls' as any)
      .select('id, call_date, call_number, description, due_date, status, journal_entry_id, capital_call_lines(id, lp_entity_id, amount, notice_document_id)')
      .eq('id', id).eq('fund_id', fundId).eq('vehicle_id', vehicleId)
      .maybeSingle()
    if (!data) return { error: 'Capital call not found on this vehicle', status: 404 }
    row = data
    entryIds = [row.journal_entry_id].filter(Boolean)
  } else {
    const { data } = await admin
      .from('distributions' as any)
      .select('id, distribution_date, distribution_number, description, status, journal_entry_id, carry_journal_entry_id, wf_return_of_capital, wf_preferred, distribution_lines(id, lp_entity_id, amount, role, notice_document_id)')
      .eq('id', id).eq('fund_id', fundId).eq('vehicle_id', vehicleId)
      .maybeSingle()
    if (!data) return { error: 'Distribution not found on this vehicle', status: 404 }
    row = data
    entryIds = [row.journal_entry_id, row.carry_journal_entry_id].filter(Boolean)
  }

  const rawLines: any[] = kind === 'capital_call' ? (row.capital_call_lines ?? []) : (row.distribution_lines ?? [])
  const lines: NoticeLine[] = rawLines.map(l => ({
    id: l.id,
    lpEntityId: l.lp_entity_id,
    amount: Number(l.amount),
    role: l.role === 'carry' ? 'carry' : 'lp',
    noticeDocumentId: l.notice_document_id ?? null,
  }))
  if (lines.length === 0) return { error: 'That has no partner lines to notice', status: 400 }

  // REFUSE TO NOTICE SOMETHING NOT IN THE BOOKS.
  //
  // A notice is a demand for money, or a promise of it. Sending one for a draft — or for an
  // entry that was voided after the fact — tells a partner to wire against something the fund
  // has no record of owing or being owed. A tracking vehicle keeps no entry; there the register
  // row is the record, and 'issued' / 'declared' is the check.
  let posted = false
  if (tracking) {
    posted = row.status === 'issued' || row.status === 'declared'
    if (!posted) return { error: `That is still a ${row.status}; issue it before sending notices.`, status: 400 }
  } else {
    if (entryIds.length === 0) {
      return { error: 'That has no journal entry — it was never posted, so there is nothing to notice.', status: 400 }
    }
    const { data: entries } = await admin
      .from('journal_entries' as any).select('id, status').eq('book', ACTUAL_BOOK).eq('fund_id', fundId).in('id', entryIds)
    const statuses = ((entries as any[]) ?? []).map(e => e.status)
    posted = statuses.length === entryIds.length && statuses.every(s => s === 'posted')
    if (!posted) {
      const bad = statuses.find(s => s !== 'posted') ?? 'missing'
      return { error: `Its journal entry is ${bad}, not posted. Post it before sending notices — otherwise the notice states an amount the books don't carry.`, status: 400 }
    }
  }

  const lpTotal = roundCents(lines.filter(l => l.role === 'lp').reduce((s, l) => s + l.amount, 0))
  return {
    kind,
    id,
    noticeDate: kind === 'capital_call' ? row.call_date : row.distribution_date,
    description: row.description ?? null,
    numberLabel: (kind === 'capital_call' ? row.call_number : row.distribution_number) ?? null,
    dueDate: kind === 'capital_call' ? (row.due_date ?? null) : null,
    lines,
    tiers: kind === 'distribution' && row.wf_return_of_capital != null
      ? { returnOfCapital: Number(row.wf_return_of_capital), preferred: Number(row.wf_preferred ?? 0), lpTotal }
      : null,
    posted,
    tracking,
  }
}

export function noticeTitle(reg: Pick<NoticeRegister, 'kind' | 'numberLabel' | 'noticeDate'>): string {
  return reg.kind === 'capital_call'
    ? `Capital Call Notice${reg.numberLabel ? ` No. ${reg.numberLabel}` : ''} — ${reg.noticeDate}`
    : `Distribution Notice${reg.numberLabel ? ` No. ${reg.numberLabel}` : ''} — ${reg.noticeDate}`
}

export interface PublishedNotice {
  lineId: string
  lpEntityId: string
  name: string
  amount: number
  documentId: string
  investorId: string | null
  /** True when the document already existed and was reused. */
  reused: boolean
}

export interface PublishContext {
  fundId: string
  group: string
  userId: string
}

/**
 * One notice per selected partner, filed in their portal. Idempotent: a line that already has a
 * notice document keeps it unless `regenerate` is set.
 */
export async function publishNotices(
  admin: SupabaseClient,
  ctx: PublishContext,
  reg: NoticeRegister,
  opts: { lpEntityIds?: string[]; regenerate?: boolean } = {},
): Promise<{ published: PublishedNotice[]; errors: string[] }> {
  const { fundId, group, userId } = ctx
  const requested = opts.lpEntityIds ?? []
  const targets = requested.length > 0 ? reg.lines.filter(l => requested.includes(l.lpEntityId)) : reg.lines
  if (targets.length === 0) return { published: [], errors: ['No partners selected'] }

  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const [fundRes, settingsRes, vehSettingsRes, names, summary, entityRows] = await Promise.all([
    admin.from('funds' as any).select('name, logo_url, address').eq('id', fundId).maybeSingle(),
    admin.from('fund_settings' as any).select('currency, theme').eq('fund_id', fundId).maybeSingle(),
    admin.from('vehicle_accounting_settings' as any).select('wire_instructions').eq('vehicle_id', vehicleId).maybeSingle(),
    loadEntityNames(admin, fundId, group),
    lpCapitalSummary(admin, fundId, group),
    admin.from('lp_entities' as any).select('id, investor_id').eq('fund_id', fundId).in('id', targets.map(t => t.lpEntityId)),
  ])
  const fund = (fundRes as any).data
  // A remote logo URL silently fails to render inside headless Chrome — only a data URI is
  // safe, the same constraint every other PDF generator here carries.
  const fundLogo = (fund?.logo_url && typeof fund.logo_url === 'string' && fund.logo_url.startsWith('data:image/'))
    ? fund.logo_url : null
  const currency = (settingsRes as any).data?.currency || 'USD'
  const wireInstructions = (vehSettingsRes as any).data?.wire_instructions ?? null
  const summaryByLp = new Map(summary.map(r => [r.lpEntityId, r]))
  const investorByEntity = new Map<string, string | null>(
    (((entityRows as any).data as any[]) ?? []).map(e => [e.id as string, (e.investor_id ?? null) as string | null])
  )

  const title = noticeTitle(reg)
  const table = reg.kind === 'capital_call' ? 'capital_call_lines' : 'distribution_lines'
  const published: PublishedNotice[] = []
  const errors: string[] = []

  await runPool(targets, 3, async line => {
    const partnerName = names.get(line.lpEntityId) ?? line.lpEntityId
    const investorId = investorByEntity.get(line.lpEntityId) ?? null
    try {
      // Reuse the document the line already produced. The partner's portal then holds ONE
      // notice for this call, however many times the GP presses the button.
      if (line.noticeDocumentId && !opts.regenerate) {
        const { data: existing } = await admin.from('lp_documents' as any).select('id').eq('id', line.noticeDocumentId).eq('fund_id', fundId).maybeSingle()
        if (existing) {
          if (investorId) await ensureShare(admin, fundId, line.noticeDocumentId, investorId)
          published.push({ lineId: line.id, lpEntityId: line.lpEntityId, name: partnerName, amount: line.amount, documentId: line.noticeDocumentId, investorId, reused: true })
          return
        }
      }

      const row = summaryByLp.get(line.lpEntityId)
      // Context is the partner's standing position, which legitimately moves. The AMOUNT is
      // the frozen register line and never comes from here.
      const context: { label: string; value: number }[] = []
      if (reg.kind === 'capital_call' && row) {
        context.push(
          { label: 'Commitment', value: row.commitment },
          { label: 'Called to date', value: row.called },
          { label: 'Remaining to be called', value: row.outstanding },
        )
      } else if (reg.kind === 'distribution') {
        if (line.role === 'lp' && reg.tiers && reg.tiers.lpTotal > 0) {
          const share = line.amount / reg.tiers.lpTotal
          context.push({ label: 'Of which return of capital', value: roundCents(reg.tiers.returnOfCapital * share) })
          if (reg.tiers.preferred > 0) context.push({ label: 'Of which preferred return', value: roundCents(reg.tiers.preferred * share) })
        }
        if (row) context.push({ label: 'Capital account balance', value: row.ending })
      }

      const pdf = await generateNoticePdf({
        kind: reg.kind,
        displayFont: displayFontOf((settingsRes as any).data?.theme),
        fundName: fund?.name || '',
        fundLogo,
        fundAddress: fund?.address || null,
        currency,
        vehicle: group,
        partnerName,
        noticeDate: reg.noticeDate,
        number: reg.numberLabel,
        description: line.role === 'carry' ? `${reg.description ?? 'Distribution'} — carried interest` : reg.description,
        amount: line.amount,
        dueDate: reg.dueDate,
        wireInstructions,
        context,
      })

      const fileName = `${title.replace(/[^a-zA-Z0-9 ._-]/g, '_')} — ${partnerName.replace(/[^a-zA-Z0-9 ._-]/g, '_')}.pdf`
      const storagePath = `${fundId}/${Date.now()}_${fileName}`
      const { error: upErr } = await admin.storage
        .from('lp-documents')
        .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
      if (upErr) { errors.push(`${partnerName}: upload failed — ${upErr.message}`); return }

      const { data: doc, error: docErr } = await admin
        .from('lp_documents' as any)
        .insert({
          fund_id: fundId,
          title,
          file_name: fileName,
          storage_path: storagePath,
          mime_type: 'application/pdf',
          size_bytes: pdf.length,
          scope: 'investor', // a notice states one partner's amount
          vehicle: group,
          category: reg.kind === 'capital_call' ? 'Capital Call Notice' : 'Distribution Notice',
          doc_date: reg.noticeDate,
          uploaded_by: userId,
        })
        .select('id')
        .single()
      if (docErr || !doc) { errors.push(`${partnerName}: ${docErr?.message ?? 'insert failed'}`); return }
      const documentId = (doc as any).id as string

      await admin.from(table as any).update({ notice_document_id: documentId }).eq('id', line.id).eq('fund_id', fundId)

      if (investorId) {
        await ensureShare(admin, fundId, documentId, investorId)
      } else {
        // Stored, but nobody can open it until the entity is linked to an LP investor. Report
        // it rather than counting a silent success.
        errors.push(`${partnerName}: generated, but not shared — this entity has no linked LP investor.`)
      }
      published.push({ lineId: line.id, lpEntityId: line.lpEntityId, name: partnerName, amount: line.amount, documentId, investorId, reused: false })
    } catch (e: any) {
      errors.push(`${partnerName}: ${e?.message ?? 'could not generate the notice'}`)
    }
  })

  return { published, errors }
}

async function ensureShare(admin: SupabaseClient, fundId: string, documentId: string, investorId: string): Promise<void> {
  const { data } = await admin.from('lp_document_shares' as any).select('id').eq('document_id', documentId).eq('lp_investor_id', investorId).maybeSingle()
  if (data) return
  await admin.from('lp_document_shares' as any).insert({ document_id: documentId, lp_investor_id: investorId, fund_id: fundId })
}

export type NoticeDelivery = 'link' | 'attachment' | 'both'

export interface NoticeEmailOptions {
  subject?: string | null
  message?: string | null
  delivery: NoticeDelivery
}

export interface NoticeRecipientPreview {
  lpEntityId: string
  name: string
  amount: number
  to: string | null
  cc: string[]
  /** Why nothing would be sent to this partner. */
  skipped: string | null
}

/** Who each partner's notice would go to, without sending. */
export async function previewNoticeRecipients(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  reg: NoticeRegister,
  lpEntityIds: string[] | undefined,
): Promise<{ recipients: NoticeRecipientPreview[]; portalEnabled: boolean; hasProvider: boolean; subject: string; html: string }> {
  const requested = lpEntityIds ?? []
  const targets = requested.length > 0 ? reg.lines.filter(l => requested.includes(l.lpEntityId)) : reg.lines
  const [names, entityRows, fs, fundRes, config] = await Promise.all([
    loadEntityNames(admin, fundId, group),
    admin.from('lp_entities' as any).select('id, investor_id').eq('fund_id', fundId).in('id', targets.map(t => t.lpEntityId)),
    (admin as any).from('fund_settings').select('lp_portal_enabled').eq('fund_id', fundId).maybeSingle(),
    admin.from('funds' as any).select('name').eq('id', fundId).maybeSingle(),
    getOutboundConfig(admin, fundId),
  ])
  const investorByEntity = new Map<string, string | null>(
    (((entityRows as any).data as any[]) ?? []).map(e => [e.id as string, (e.investor_id ?? null) as string | null])
  )
  const investorIds = Array.from(new Set(Array.from(investorByEntity.values()).filter(Boolean) as string[]))
  const groups = await resolveLpRecipients(admin, fundId, investorIds)
  const groupByInvestor = new Map<string, { to: string; cc: string[] }>()
  for (const g of groups) for (const inv of g.investorIds) groupByInvestor.set(inv, { to: g.primaryEmail, cc: g.ccEmails })

  const recipients: NoticeRecipientPreview[] = targets.map(line => {
    const investorId = investorByEntity.get(line.lpEntityId) ?? null
    const g = investorId ? groupByInvestor.get(investorId) : undefined
    return {
      lpEntityId: line.lpEntityId,
      name: names.get(line.lpEntityId) ?? line.lpEntityId,
      amount: line.amount,
      to: g?.to ?? null,
      cc: g?.cc ?? [],
      skipped: !investorId ? 'No linked LP investor' : !g ? 'No portal account yet — invite them from LP Portal → Access' : null,
    }
  })
  const fundName = ((fundRes as any).data?.name as string | undefined) || 'Your fund'
  const subject = `${fundName}: ${noticeTitle(reg)}`
  const html = buildLpEmailHtml({
    fundName,
    itemTitle: noticeTitle(reg),
    message: '',
    link: `${siteUrl()}/portal/notices`,
    linkLabel: 'View the notice',
    facts: [
      { label: reg.kind === 'capital_call' ? 'Amount due' : 'Amount payable', value: '(each partner’s own amount)' },
      ...(reg.dueDate ? [{ label: 'Due', value: reg.dueDate }] : []),
    ],
  })
  return { recipients, portalEnabled: !!(fs as any)?.data?.lp_portal_enabled, hasProvider: !!config, subject, html }
}

export interface NoticeSendResult {
  sent: number
  failures: string[]
  skipped: string[]
}

/** Email each published notice to its partner, logging every send. */
export async function emailNotices(
  admin: SupabaseClient,
  ctx: PublishContext,
  reg: NoticeRegister,
  published: PublishedNotice[],
  opts: NoticeEmailOptions,
): Promise<NoticeSendResult | { error: string }> {
  const { fundId, userId } = ctx
  const [fs, fundRes, settingsRes, config] = await Promise.all([
    (admin as any).from('fund_settings').select('lp_portal_enabled').eq('fund_id', fundId).maybeSingle(),
    admin.from('funds' as any).select('name').eq('id', fundId).maybeSingle(),
    admin.from('fund_settings' as any).select('currency').eq('fund_id', fundId).maybeSingle(),
    getOutboundConfig(admin, fundId),
  ])
  const portalEnabled = !!(fs as any)?.data?.lp_portal_enabled
  if (!portalEnabled && opts.delivery !== 'attachment') {
    return { error: 'The LP portal is off, so portal links won’t work. Enable it in Settings, or send as a PDF attachment instead.' }
  }
  if (!config) return { error: 'No outbound email provider is configured for this fund.' }

  const fundName = ((fundRes as any).data?.name as string | undefined) || 'Your fund'
  const currency = ((settingsRes as any).data?.currency as string | undefined) || 'USD'
  const title = noticeTitle(reg)
  const subject = opts.subject?.trim() || `${fundName}: ${title}`
  const message = opts.message ?? ''
  const link = opts.delivery === 'attachment' ? null : `${siteUrl()}/portal/notices`
  const wantsAttachment = opts.delivery !== 'link'

  const investorIds = Array.from(new Set(published.map(p => p.investorId).filter(Boolean) as string[]))
  const groups = await resolveLpRecipients(admin, fundId, investorIds)
  const groupByInvestor = new Map<string, { to: string; cc: string[] }>()
  for (const g of groups) for (const inv of g.investorIds) groupByInvestor.set(inv, { to: g.primaryEmail, cc: g.ccEmails })

  const result: NoticeSendResult = { sent: 0, failures: [], skipped: [] }
  const fmt = (v: number) => `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  await runPool(published, 3, async p => {
    const g = p.investorId ? groupByInvestor.get(p.investorId) : undefined
    if (!g) { result.skipped.push(`${p.name}: no portal account`); return }

    const facts = [
      { label: reg.kind === 'capital_call' ? 'Amount due' : 'Amount payable', value: fmt(p.amount) },
      ...(reg.dueDate ? [{ label: 'Due', value: reg.dueDate }] : []),
    ]
    const html = buildLpEmailHtml({ fundName, itemTitle: title, message, link, linkLabel: 'View the notice', facts })

    const attachments: EmailAttachment[] = []
    if (wantsAttachment) {
      const { data: doc } = await admin.from('lp_documents' as any).select('storage_path, file_name').eq('id', p.documentId).maybeSingle()
      const path = (doc as any)?.storage_path as string | undefined
      const blob = path ? (await admin.storage.from('lp-documents').download(path)).data : null
      if (!blob) { result.failures.push(`${p.name}: could not read the notice PDF`); return }
      attachments.push({ filename: (doc as any).file_name, content: Buffer.from(await blob.arrayBuffer()), contentType: 'application/pdf' })
    }

    try {
      const sent = await sendOutboundEmail(config, {
        to: g.to,
        cc: g.cc.length ? g.cc.join(', ') : undefined,
        subject,
        html,
        attachments: attachments.length ? attachments : undefined,
      })
      result.sent += 1
      await logDelivery(admin, {
        fundId, kind: 'notice', itemId: p.lineId, lpInvestorId: p.investorId, lpEntityId: p.lpEntityId,
        toEmail: g.to, ccEmails: g.cc, subject, provider: config.provider, providerMessageId: sent.id ?? null, sentBy: userId,
      })
    } catch (e) {
      const msg = (e as Error)?.message ?? 'send failed'
      result.failures.push(`${p.name}: ${msg}`)
      await logDelivery(admin, {
        fundId, kind: 'notice', itemId: p.lineId, lpInvestorId: p.investorId, lpEntityId: p.lpEntityId,
        toEmail: g.to, ccEmails: g.cc, subject, provider: config.provider, status: 'failed', error: msg, sentBy: userId,
      })
    }
  })

  return result
}
