import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { createFundAIProviderWithOverride } from '@/lib/ai'
import { loadPostedLedger, loadEntityNames } from '@/lib/accounting/load'
import { accountIdByCode, persistEntry } from '@/lib/accounting/persist'
import { buildDraftPrompt, parseDraftedEntry, resolveDraftedEntry } from '@/lib/accounting/draft'
import { isBalanced } from '@/lib/accounting/ledger'

// POST — draft a balanced journal entry from a pasted source document using the
// fund's configured AI provider. Returns a draft proposal for human review; if
// { post: true } and the proposal balances, it's saved as a draft entry.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  let text: string = (body?.text ?? '').toString()
  if (body?.pdfBase64) {
    try {
      const { getDocumentProxy, extractText } = await import('unpdf')
      const bytes = new Uint8Array(Buffer.from(String(body.pdfBase64), 'base64'))
      const pdf = await getDocumentProxy(bytes)
      const extracted = await extractText(pdf, { mergePages: true })
      text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text
    } catch (e) {
      return NextResponse.json({ error: `Could not read the PDF: ${(e as Error).message}` }, { status: 400 })
    }
  }
  if (text.trim().length < 10) {
    return NextResponse.json({ error: 'Paste or upload a source document to draft from' }, { status: 400 })
  }

  const { accounts } = await loadPostedLedger(admin, gate.fundId, group)
  if (accounts.length === 0) {
    return NextResponse.json({ error: 'Seed the chart of accounts first' }, { status: 400 })
  }

  let providerBundle
  try {
    providerBundle = await createFundAIProviderWithOverride(admin, gate.fundId, body?.provider)
  } catch (e) {
    return NextResponse.json({ error: `AI provider not configured: ${(e as Error).message}` }, { status: 400 })
  }

  const { system, content } = buildDraftPrompt(accounts, text)
  let modelText: string
  try {
    const result = await providerBundle.provider.createMessage({
      model: providerBundle.model,
      maxTokens: 1500,
      system,
      content,
    })
    modelText = result.text
  } catch (e) {
    return NextResponse.json({ error: `AI request failed: ${(e as Error).message}` }, { status: 502 })
  }

  let drafted
  try {
    drafted = parseDraftedEntry(modelText)
  } catch (e) {
    return NextResponse.json({ error: `Could not parse the drafted entry: ${(e as Error).message}`, raw: modelText }, { status: 422 })
  }

  const [codes, names] = await Promise.all([
    accountIdByCode(admin, gate.fundId, group),
    loadEntityNames(admin, gate.fundId, group),
  ])
  const entityByName = new Map(Array.from(names.entries()).map(([id, name]) => [name.toLowerCase(), id]))

  const { entry, imbalance, unknownCodes } = resolveDraftedEntry(drafted, gate.fundId, codes, entityByName)
  const balanced = isBalanced(entry) && unknownCodes.length === 0

  let savedEntryId: string | null = null
  if (body?.post && balanced) {
    const result = await persistEntry(admin, gate.fundId, group, user.id, entry, 'draft')
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    savedEntryId = result.entryId
  }

  return NextResponse.json({
    draft: entry,
    balanced,
    imbalance,
    unknownCodes,
    savedEntryId,
  })
}
