import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import { scanFile } from '@/lib/security/scan-file'
import { logLpAccessEvent } from '@/lib/lp-access-log'
import { logOnboardingEvent, attachItemDocument, loadItemDocuments } from '@/lib/lp-onboarding-audit'
import { notifyFundOfUpload, notifyFundOfWireChange } from '@/lib/lp-onboarding-notify'
import { DEFAULT_CONSENT_DISCLOSURE } from '@/lib/tax/delivery'
import {
  buildOnboardingMatrix, normalizeKinds, isOnboardingKind, onboardingStoragePrefix, loadClosingsByEntity, closingPhrase,
  DEFAULT_ONBOARDING_KINDS, ONBOARDING_KIND_LABEL, ONBOARDING_KIND_HELP, ONBOARDING_MAX_UPLOAD_BYTES, ONBOARDING_ALLOWED_MIME,
  type OnboardingEntity, type OnboardingItemRow,
} from '@/lib/lp-onboarding'

/**
 * LP portal — the LP's own onboarding checklist, and the one write an LP makes to the platform.
 *
 *   GET  → their entities, each with the fund's required items: status, the fund's note when
 *          something was sent back, and the document they uploaded (viewable through the usual
 *          /api/portal/documents/[id], which already checks the share).
 *   POST { lp_entity_id, kind, storage_path, file_name, mime_type?, size_bytes? }
 *        → record an upload the browser just made to the signed URL from ./upload-url. The
 *          entity must be one of the LP's; the path must be inside that entity's onboarding
 *          folder (the server issued it, so anything else is a forged body); the file becomes an
 *          lp_documents row scoped to that investor alone, and the item goes to 'submitted'.
 *
 * What this deliberately does NOT do: extract the file's text. Every other LP document is
 * text-indexed for the portal Analyst. A W-9 or a passport scan is not a document to make
 * searchable — the tax-forms table refuses to hold a full TIN for the same reason.
 */

type LpCtx =
  | { error: NextResponse; admin?: undefined; user?: undefined; lpAccountId?: undefined; investorIds?: undefined }
  | { error?: undefined; admin: any; user: { id: string; email?: string }; lpAccountId: string; investorIds: string[] }

async function ctx(): Promise<LpCtx> {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return { error: access }
  return { admin: admin as any, user, ...access }
}

/** The LP's entities in funds whose portal is on, with the fund's requirement set. */
async function loadEntities(admin: any, investorIds: string[]) {
  if (investorIds.length === 0) return { entities: [] as any[], kindsByFund: new Map<string, string[]>() }
  const { data: ents } = await admin
    .from('lp_entities').select('id, fund_id, entity_name, investor_id, onboarding_excluded, lp_investors(name)')
    .in('investor_id', investorIds).eq('onboarding_excluded', false).order('entity_name')
  const fundIds = Array.from(new Set(((ents ?? []) as any[]).map(e => e.fund_id as string)))
  if (fundIds.length === 0) return { entities: [] as any[], kindsByFund: new Map<string, string[]>() }
  const { data: settings } = await admin.from('fund_settings').select('fund_id, lp_portal_enabled, lp_onboarding_kinds').in('fund_id', fundIds)
  const kindsByFund = new Map<string, string[]>()
  for (const s of (settings ?? []) as any[]) {
    if (!s.lp_portal_enabled) continue
    kindsByFund.set(s.fund_id, s.lp_onboarding_kinds == null ? DEFAULT_ONBOARDING_KINDS : normalizeKinds(s.lp_onboarding_kinds))
  }
  return { entities: ((ents ?? []) as any[]).filter(e => kindsByFund.has(e.fund_id)), kindsByFund }
}

export async function GET(): Promise<NextResponse> {
  const c = await ctx()
  if (c.error) return c.error
  const { admin, investorIds, lpAccountId } = c

  const { entities, kindsByFund } = await loadEntities(admin, investorIds)
  if (entities.length === 0) return NextResponse.json({ entities: [] })

  const { data: items } = await admin
    .from('lp_onboarding_items')
    .select('id, lp_entity_id, kind, status, document_id, submitted_at, reviewed_at, expires_on, note')
    .in('lp_entity_id', entities.map(e => e.id))
  const docsByItem = await loadItemDocuments(admin, ((items ?? []) as any[]).map(i => i.id))

  const closings = await loadClosingsByEntity(admin, entities.map(e => e.id))
  // Electronic K-1 consent is the investor's own election: the principal account gives it.
  const { data: me } = await admin.from('lp_accounts').select('kind').eq('id', lpAccountId).maybeSingle()
  const canConsent = (me as { kind?: string } | null)?.kind === 'lp'

  // Fund names, for an LP in more than one.
  const fundIds = Array.from(new Set(entities.map(e => e.fund_id as string)))
  const { data: funds } = await admin.from('funds').select('id, name').in('id', fundIds)
  const fundName = new Map<string, string>(((funds ?? []) as any[]).map(f => [f.id, f.name]))

  // One matrix per fund, since each fund has its own requirement set.
  const out: any[] = []
  for (const fundId of fundIds) {
    const list: OnboardingEntity[] = entities.filter(e => e.fund_id === fundId).map(e => ({
      id: e.id, name: e.entity_name, investorId: e.investor_id, investorName: e.lp_investors?.name ?? '',
      closing: closings.get(e.id) ?? null,
    }))
    const rows = buildOnboardingMatrix(list, kindsByFund.get(fundId) as any, (items ?? []) as OnboardingItemRow[])
    for (const r of rows) {
      out.push({
        id: r.id, name: r.name, fundName: fundName.get(fundId) ?? '', outstanding: r.outstanding, complete: r.complete,
        closing: r.closing ? { name: r.closing.name, closeDate: r.closing.closeDate, phrase: closingPhrase(r.closing, r.daysToClose), daysToClose: r.daysToClose } : null,
        items: r.items.map(i => ({
          kind: i.kind, label: i.label, help: ONBOARDING_KIND_HELP[i.kind], status: i.status, expired: i.expired,
          documentId: i.documentId, submittedAt: i.submittedAt, reviewedAt: i.reviewedAt, expiresOn: i.expiresOn,
          documents: (i.itemId ? docsByItem.get(i.itemId) ?? [] : []).map(d => ({ id: d.id, fileName: d.file_name, addedAt: d.added_at, mine: d.added_by_account === lpAccountId })),
          // The fund's note is for the LP only when the item was sent back or waived.
          note: i.status === 'rejected' || i.status === 'waived' ? i.note : null,
        })),
      })
    }
  }
  return NextResponse.json({ entities: out, maxBytes: ONBOARDING_MAX_UPLOAD_BYTES, canConsent, disclosure: DEFAULT_CONSENT_DISCLOSURE })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const c = await ctx()
  if (c.error) return c.error
  const { admin, user, investorIds, lpAccountId } = c

  const limited = await rateLimit({ key: `lp-onboarding:${user.id}`, limit: 30, windowSeconds: 600 })
  if (limited) return limited

  const body = await req.json().catch(() => ({}))
  const entityId = typeof body.lp_entity_id === 'string' ? body.lp_entity_id : ''
  const kind = body.kind
  const storagePath = typeof body.storage_path === 'string' ? body.storage_path : ''
  const fileName = typeof body.file_name === 'string' ? body.file_name.trim().slice(0, 200) : ''
  const mimeType = typeof body.mime_type === 'string' ? body.mime_type : null
  const sizeBytes = typeof body.size_bytes === 'number' && Number.isFinite(body.size_bytes) ? Math.max(0, Math.floor(body.size_bytes)) : null
  if (!entityId) return NextResponse.json({ error: 'lp_entity_id is required' }, { status: 400 })
  if (!isOnboardingKind(kind)) return NextResponse.json({ error: 'Unknown document kind' }, { status: 400 })
  if (kind === 'k1_econsent') return NextResponse.json({ error: 'Electronic delivery consent is given from the checklist, not uploaded.' }, { status: 400 })
  if (!storagePath || !fileName) return NextResponse.json({ error: 'storage_path and file_name are required' }, { status: 400 })
  if (mimeType && !ONBOARDING_ALLOWED_MIME.has(mimeType)) return NextResponse.json({ error: 'Upload a PDF, an image, or a Word document.' }, { status: 400 })
  if (sizeBytes != null && sizeBytes > ONBOARDING_MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'That file is too large (25 MB max).' }, { status: 400 })

  // The entity must be one of the LP's own, in a fund whose portal is on.
  const { entities, kindsByFund } = await loadEntities(admin, investorIds)
  const entity = entities.find(e => e.id === entityId)
  if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const fundId = entity.fund_id as string

  // The server issued the path (./upload-url) inside this entity's folder. A body naming any
  // other path is not an upload we made a URL for.
  const prefix = onboardingStoragePrefix(fundId, entityId)
  if (!storagePath.startsWith(prefix) || storagePath.includes('..')) return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })

  // It has to be there, and it has to be clean. This is the one path an external user pushes a
  // file into the platform, so it gets the same scan every other inbound file gets; a hit is
  // deleted from storage before anything is recorded.
  const { data: blob, error: dlErr } = await admin.storage.from('lp-documents').download(storagePath)
  if (dlErr || !blob) return NextResponse.json({ error: 'The upload did not complete. Try again.' }, { status: 400 })
  const scan = scanFile(Buffer.from(await blob.arrayBuffer()), fileName, mimeType ?? '')
  if (!scan.safe) {
    await admin.storage.from('lp-documents').remove([storagePath])
    return NextResponse.json({ error: `That file was rejected: ${scan.reason ?? 'it did not pass the safety check'}.` }, { status: 400 })
  }

  const kinds = kindsByFund.get(fundId) ?? []
  const title = `${ONBOARDING_KIND_LABEL[kind]} — ${entity.entity_name}`
  const now = new Date().toISOString()

  const { data: doc, error: docErr } = await admin
    .from('lp_documents')
    .insert({
      fund_id: fundId, title, file_name: fileName, storage_path: storagePath, mime_type: mimeType, size_bytes: sizeBytes,
      scope: 'investor', category: 'Onboarding', doc_date: now.slice(0, 10), uploaded_by: user.id,
    })
    .select('id').single()
  if (docErr || !doc) return dbError(docErr ?? { message: 'Insert failed' }, 'portal-onboarding')
  await admin.from('lp_document_shares').insert({ document_id: doc.id, lp_investor_id: entity.investor_id, fund_id: fundId })

  // A fresh upload puts the item back under review: sent back → submitted again. The latest
  // file becomes document_id; every file stays in the item's set.
  const { data: prev } = await admin.from('lp_onboarding_items').select('id, status').eq('fund_id', fundId).eq('lp_entity_id', entityId).eq('kind', kind).maybeSingle()
  const { data: item, error: itemErr } = await admin
    .from('lp_onboarding_items')
    .upsert({
      fund_id: fundId, lp_entity_id: entityId, kind, status: 'submitted', document_id: doc.id,
      submitted_by_account: lpAccountId, submitted_at: now, reviewed_by: null, reviewed_at: null, expires_on: null, note: null, updated_at: now,
    }, { onConflict: 'fund_id,lp_entity_id,kind' })
    .select('id, status').single()
  if (itemErr) return dbError(itemErr, 'portal-onboarding')
  await attachItemDocument(admin, { fundId, itemId: item.id, documentId: doc.id, addedByAccount: lpAccountId })
  await logOnboardingEvent(admin, { fundId, itemId: item.id, lpEntityId: entityId, kind, action: 'submitted', fromStatus: prev?.status ?? 'outstanding', toStatus: 'submitted', documentId: doc.id, actorAccountId: lpAccountId })
  await logLpAccessEvent(admin, { fundId, lpAccountId, authUserId: user.id, lpInvestorId: entity.investor_id, eventType: 'upload', targetType: 'document', targetId: doc.id, targetTitle: title, metadata: { kind, lp_entity_id: entityId } })

  // Tell the fund: a message in the LP inbox, and an email to the admins like the Contact form.
  const { data: acct } = await admin.from('lp_accounts').select('email, kind').eq('id', lpAccountId).maybeSingle()
  const byAdvisor = acct?.kind === 'authorized_user'
  const fromEmail = acct?.email ?? user.email ?? null
  // Replaced wire instructions the fund had verified: the loud version, not the routine one.
  const wireChanged = kind === 'wire_instructions' && prev?.status === 'verified'
  if (wireChanged) await notifyFundOfWireChange(admin, { fundId, entityName: entity.entity_name, fileName, fromEmail, byAdvisor })
  else await notifyFundOfUpload(admin, { fundId, entityName: entity.entity_name, kind, fileName, fromEmail, byAdvisor })
  const uploader = byAdvisor ? `${acct?.email ?? 'An authorized user'}, acting for ${entity.entity_name},` : entity.entity_name
  await admin.from('lp_messages').insert({
    fund_id: fundId, lp_account_id: lpAccountId, lp_investor_id: entity.investor_id, from_email: fromEmail,
    subject: wireChanged ? 'Wire instructions changed — verify by callback' : `Onboarding upload: ${ONBOARDING_KIND_LABEL[kind]}`,
    body: wireChanged
      ? `${uploader} replaced wire instructions you had verified with "${fileName}". The previous verification no longer stands. Confirm the new instructions by calling a number you already hold for this investor before paying against them, then verify again under LP Portal → Onboarding.`
      : `${uploader} uploaded "${fileName}" for ${ONBOARDING_KIND_LABEL[kind]}${kinds.includes(kind) ? '' : ' (not in your current requirement set)'}. Review it under LP Portal → Onboarding.`,
    direction: 'inbound', status: 'open',
  })

  return NextResponse.json({ ok: true, documentId: doc.id, item })
}

/**
 * PATCH { lp_entity_id, entity_name } → the LP renames their own entity. The fund named it after
 * the investor when it invited them; the legal name on the subscription document is the LP's to
 * say. Unique per fund, so a clash is a 409 rather than a silent overwrite; the fund hears about
 * the change in its inbox and the audit trail.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const c = await ctx()
  if ('error' in c && c.error) return c.error
  const { admin, user, investorIds, lpAccountId } = c as Extract<LpCtx, { error?: undefined }>

  const body = await req.json().catch(() => ({}))
  const entityId = typeof body.lp_entity_id === 'string' ? body.lp_entity_id : ''
  const name = typeof body.entity_name === 'string' ? body.entity_name.trim().replace(/\s+/g, ' ').slice(0, 200) : ''
  if (!entityId) return NextResponse.json({ error: 'lp_entity_id is required' }, { status: 400 })
  if (name.length < 2) return NextResponse.json({ error: 'Enter the entity\'s legal name' }, { status: 400 })

  const { entities } = await loadEntities(admin, investorIds)
  const entity = entities.find(e => e.id === entityId)
  if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (entity.entity_name === name) return NextResponse.json({ ok: true, entity_name: name })

  const { error } = await admin.from('lp_entities').update({ entity_name: name }).eq('id', entityId).eq('fund_id', entity.fund_id)
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Another entity in this fund already has that name. If it is yours, ask the fund to merge them.' }, { status: 409 })
    return dbError(error, 'portal-onboarding-rename')
  }
  await logOnboardingEvent(admin, { fundId: entity.fund_id, itemId: null, lpEntityId: entityId, kind: 'all', action: 'renamed', note: `${entity.entity_name} → ${name}`, actorAccountId: lpAccountId })
  const { data: acct } = await admin.from('lp_accounts').select('email').eq('id', lpAccountId).maybeSingle()
  await admin.from('lp_messages').insert({
    fund_id: entity.fund_id, lp_account_id: lpAccountId, lp_investor_id: entity.investor_id, from_email: acct?.email ?? user.email ?? null,
    subject: 'Entity renamed', body: `"${entity.entity_name}" is now "${name}", per the LP. Check it against the executed subscription document.`, direction: 'inbound', status: 'open',
  })
  return NextResponse.json({ ok: true, entity_name: name })
}

/**
 * DELETE { document_id } → the LP withdraws a file they uploaded, while the fund has not yet
 * looked at it. The wrong file, a draft, a duplicate. Only their own upload, only while the item
 * is still awaiting review; after that the fund's decision stands and a new upload is the way to
 * replace it. The file is removed from storage, the document and its share deleted, and the
 * item put back to what it was before the upload if nothing else remains on it.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const c = await ctx()
  if ('error' in c && c.error) return c.error
  const { admin, lpAccountId } = c as Extract<LpCtx, { error?: undefined }>

  const body = await req.json().catch(() => ({}))
  const documentId = typeof body.document_id === 'string' ? body.document_id : ''
  if (!documentId) return NextResponse.json({ error: 'document_id is required' }, { status: 400 })

  // Their own upload: the item-document row names the account that added it.
  const { data: link } = await admin
    .from('lp_onboarding_item_documents')
    .select('id, item_id, fund_id, lp_onboarding_items(id, lp_entity_id, kind, status, document_id, submitted_at)')
    .eq('document_id', documentId).eq('added_by_account', lpAccountId).maybeSingle()
  const item = link ? (Array.isArray(link.lp_onboarding_items) ? link.lp_onboarding_items[0] : link.lp_onboarding_items) : null
  if (!link || !item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (item.status !== 'submitted') return NextResponse.json({ error: 'The fund has already reviewed this item. Upload a new file to replace it.' }, { status: 409 })

  const { data: doc } = await admin.from('lp_documents').select('id, storage_path, file_name').eq('id', documentId).eq('fund_id', link.fund_id).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await admin.storage.from('lp-documents').remove([doc.storage_path])
  await admin.from('lp_onboarding_item_documents').delete().eq('id', link.id)
  await admin.from('lp_document_shares').delete().eq('document_id', documentId)
  await admin.from('lp_documents').delete().eq('id', documentId)

  // What is left on the item decides its state: the latest remaining file, or nothing.
  const { data: remaining } = await admin
    .from('lp_onboarding_item_documents').select('document_id, added_at').eq('item_id', item.id).order('added_at', { ascending: false }).limit(1)
  const next = Array.isArray(remaining) && remaining[0] ? remaining[0] : null
  const now = new Date().toISOString()
  if (next) {
    await admin.from('lp_onboarding_items').update({ document_id: next.document_id, updated_at: now }).eq('id', item.id)
  } else {
    await admin.from('lp_onboarding_items').update({ status: 'outstanding', document_id: null, submitted_by_account: null, submitted_at: null, updated_at: now }).eq('id', item.id)
  }
  await logOnboardingEvent(admin, {
    fundId: link.fund_id, itemId: item.id, lpEntityId: item.lp_entity_id, kind: item.kind, action: 'withdrawn',
    fromStatus: 'submitted', toStatus: next ? 'submitted' : 'outstanding', note: doc.file_name, actorAccountId: lpAccountId,
  })
  return NextResponse.json({ ok: true, status: next ? 'submitted' : 'outstanding' })
}
