import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// lp_relations domain (lib/access/route-domains.ts) — publishing is what goes OUT to an LP,
// gated exactly like the capital-account statement it sits beside.
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { runPool } from '@/lib/lp-report-pdf'
import { generateNoticePdf, type NoticeKind } from '@/lib/accounting/notice-pdf'
import { lpCapitalSummary } from '@/lib/accounting/capital-calls'
import { loadEntityNames } from '@/lib/accounting/load'
import { displayFontOf } from '@/lib/theme'
import { ACTUAL_BOOK } from '@/lib/accounting/books'

export const runtime = 'nodejs'
// Each notice launches headless Chrome; a vehicle with twenty partners needs room.
export const maxDuration = 300

/** One partner's line on a call or distribution, straight from the register. */
interface NoticeLine { lpEntityId: string; amount: number }

// POST — generate a notice PDF per partner for a DECLARED call or distribution, store it in the
// `lp-documents` bucket, and share it with that partner's LP investor so it appears in their
// portal.
//
//   { kind: 'capital_call' | 'distribution', id, group?, lpEntityIds? }
//
// Every figure comes from the REGISTER, never recomputed: the 1300 receivable and the 2300
// payable both decay as money moves, so deriving a notice from the ledger would restate what a
// partner was told every time somebody paid.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const kind: NoticeKind = body?.kind === 'distribution' ? 'distribution' : 'capital_call'
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // --- Load the register row + its frozen lines -------------------------------
  let noticeDate = ''
  let description: string | null = null
  let numberLabel: number | null = null
  let dueDate: string | null = null
  let lines: NoticeLine[] = []
  let journalEntryId: string | null = null

  if (kind === 'capital_call') {
    const { data: call } = await admin
      .from('capital_calls' as any)
      .select('id, call_date, call_number, description, due_date, status, journal_entry_id, capital_call_lines(lp_entity_id, amount)')
      .eq('id', id).eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId)
      .maybeSingle()
    if (!call) return NextResponse.json({ error: 'Capital call not found on this vehicle' }, { status: 404 })
    noticeDate = (call as any).call_date
    description = (call as any).description ?? null
    numberLabel = (call as any).call_number ?? null
    dueDate = (call as any).due_date ?? null
    journalEntryId = (call as any).journal_entry_id ?? null
    lines = ((call as any).capital_call_lines ?? []).map((l: any) => ({ lpEntityId: l.lp_entity_id, amount: Number(l.amount) }))
  } else {
    const { data: dist } = await admin
      .from('distributions' as any)
      .select('id, distribution_date, distribution_number, description, status, journal_entry_id, distribution_lines(lp_entity_id, amount)')
      .eq('id', id).eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId)
      .maybeSingle()
    if (!dist) return NextResponse.json({ error: 'Distribution not found on this vehicle' }, { status: 404 })
    noticeDate = (dist as any).distribution_date
    description = (dist as any).description ?? null
    numberLabel = (dist as any).distribution_number ?? null
    journalEntryId = (dist as any).journal_entry_id ?? null
    lines = ((dist as any).distribution_lines ?? []).map((l: any) => ({ lpEntityId: l.lp_entity_id, amount: Number(l.amount) }))
  }

  if (lines.length === 0) return NextResponse.json({ error: 'That has no partner lines to notice' }, { status: 400 })

  // REFUSE TO NOTICE SOMETHING NOT IN THE BOOKS.
  //
  // A notice is a demand for money, or a promise of it. Sending one for a draft — or for an
  // entry that was voided after the fact — tells a partner to wire against something the fund
  // has no record of owing or being owed.
  if (!journalEntryId) {
    return NextResponse.json({ error: 'That has no journal entry — it was never posted, so there is nothing to notice.' }, { status: 400 })
  }
  const { data: entry } = await admin
    .from('journal_entries' as any).select('status').eq('book', ACTUAL_BOOK).eq('id', journalEntryId).eq('fund_id', gate.fundId).maybeSingle()
  if ((entry as any)?.status !== 'posted') {
    return NextResponse.json({
      error: `Its journal entry is ${(entry as any)?.status ?? 'missing'}, not posted. Post it before sending notices — otherwise the notice states an amount the books don't carry.`,
    }, { status: 400 })
  }

  // --- Recipients --------------------------------------------------------------
  const requested: string[] = Array.isArray(body?.lpEntityIds) ? body.lpEntityIds : []
  const targets = requested.length > 0 ? lines.filter(l => requested.includes(l.lpEntityId)) : lines
  if (targets.length === 0) return NextResponse.json({ error: 'No partners selected' }, { status: 400 })

  // --- Fund chrome + context ----------------------------------------------------
  const [fundRes, settingsRes, vehSettingsRes, names, summary] = await Promise.all([
    admin.from('funds' as any).select('name, logo_url, address').eq('id', gate.fundId).maybeSingle(),
    admin.from('fund_settings' as any).select('currency, theme').eq('fund_id', gate.fundId).maybeSingle(),
    admin.from('vehicle_accounting_settings' as any).select('wire_instructions').eq('vehicle_id', vehicleId).maybeSingle(),
    loadEntityNames(admin, gate.fundId, group),
    lpCapitalSummary(admin, gate.fundId, group),
  ])
  const fund = (fundRes as any).data
  // A remote logo URL silently fails to render inside headless Chrome — only a data URI is
  // safe, the same constraint every other PDF generator here carries.
  const fundLogo = (fund?.logo_url && typeof fund.logo_url === 'string' && fund.logo_url.startsWith('data:image/'))
    ? fund.logo_url : null
  const currency = (settingsRes as any).data?.currency || 'USD'
  const wireInstructions = (vehSettingsRes as any).data?.wire_instructions ?? null
  const summaryByLp = new Map(summary.map(r => [r.lpEntityId, r]))

  const { data: entityRows } = await admin
    .from('lp_entities' as any)
    .select('id, investor_id')
    .eq('fund_id', gate.fundId)
    .in('id', targets.map(t => t.lpEntityId))
  const investorByEntity = new Map<string, string | null>(
    ((entityRows as any[]) ?? []).map(e => [e.id as string, (e.investor_id ?? null) as string | null])
  )

  const title = kind === 'capital_call'
    ? `Capital Call Notice${numberLabel ? ` No. ${numberLabel}` : ''} — ${noticeDate}`
    : `Distribution Notice${numberLabel ? ` No. ${numberLabel}` : ''} — ${noticeDate}`

  const published: { lpEntityId: string; name: string; documentId: string; shared: boolean }[] = []
  const errors: string[] = []

  await runPool(targets, 3, async target => {
    const partnerName = names.get(target.lpEntityId) ?? target.lpEntityId
    try {
      const row = summaryByLp.get(target.lpEntityId)
      // Context is the partner's standing position, which legitimately moves. The AMOUNT is
      // the frozen register line and never comes from here.
      const context = row
        ? (kind === 'capital_call'
            ? [
                { label: 'Commitment', value: row.commitment },
                { label: 'Called to date', value: row.called },
                { label: 'Remaining to be called', value: row.outstanding },
              ]
            : [{ label: 'Capital account balance', value: row.ending }])
        : []

      const pdf = await generateNoticePdf({
        kind,
        displayFont: displayFontOf((settingsRes as any).data?.theme),
        fundName: fund?.name || '',
        fundLogo,
        fundAddress: fund?.address || null,
        currency,
        vehicle: group,
        partnerName,
        noticeDate,
        number: numberLabel,
        description,
        amount: target.amount,
        dueDate,
        wireInstructions,
        context,
      })

      const fileName = `${title.replace(/[^a-zA-Z0-9 ._-]/g, '_')} — ${partnerName.replace(/[^a-zA-Z0-9 ._-]/g, '_')}.pdf`
      const storagePath = `${gate.fundId}/${Date.now()}_${fileName}`

      const { error: upErr } = await admin.storage
        .from('lp-documents')
        .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
      if (upErr) { errors.push(`${partnerName}: upload failed — ${upErr.message}`); return }

      const { data: doc, error: docErr } = await admin
        .from('lp_documents' as any)
        .insert({
          fund_id: gate.fundId,
          title,
          file_name: fileName,
          storage_path: storagePath,
          mime_type: 'application/pdf',
          size_bytes: pdf.length,
          // Investor-scoped: a notice states one partner's amount.
          scope: 'investor',
          vehicle: group,
          category: kind === 'capital_call' ? 'Capital Call Notice' : 'Distribution Notice',
          doc_date: noticeDate,
          uploaded_by: user.id,
        })
        .select('id')
        .single()
      if (docErr || !doc) { errors.push(`${partnerName}: ${docErr?.message ?? 'insert failed'}`); return }

      const investorId = investorByEntity.get(target.lpEntityId) ?? null
      if (investorId) {
        await admin.from('lp_document_shares' as any).insert({
          document_id: (doc as any).id,
          lp_investor_id: investorId,
          fund_id: gate.fundId,
        })
      } else {
        // Stored, but nobody can open it until the entity is linked to an LP investor. Report
        // it rather than counting a silent success.
        errors.push(`${partnerName}: generated, but not shared — this entity has no linked LP investor.`)
      }
      published.push({ lpEntityId: target.lpEntityId, name: partnerName, documentId: (doc as any).id, shared: !!investorId })
    } catch (e: any) {
      errors.push(`${partnerName}: ${e?.message ?? 'could not generate the notice'}`)
    }
  })

  return NextResponse.json({ count: published.length, published, errors })
}
