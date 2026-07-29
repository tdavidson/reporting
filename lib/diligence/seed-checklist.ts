import type { createAdminClient } from '@/lib/supabase/admin'
import { parseChecklistText } from './parse-checklist'
import { DEFAULT_CHECKLIST_TEMPLATE } from './default-checklist'

type Admin = ReturnType<typeof createAdminClient>

/**
 * Seed a fresh deal's checklist from the fund's stored template (falling
 * back to the bundled default if the fund hasn't customized one).
 *
 * Best-effort: failures are swallowed so deal creation can't be blocked by
 * a checklist hiccup. Returns the count of rows inserted (0 on any failure
 * or when the template is empty).
 */
export async function seedDealChecklistFromFundDefault(params: {
  admin: Admin
  fundId: string
  dealId: string
}): Promise<number> {
  const { admin, fundId, dealId } = params

  let template = DEFAULT_CHECKLIST_TEMPLATE
  try {
    const { data } = await admin
      .from('fund_settings')
      .select('diligence_checklist_template')
      .eq('fund_id', fundId)
      .maybeSingle()
    const stored = ((data as any)?.diligence_checklist_template ?? '').toString().trim()
    if (stored) template = stored
  } catch {
    // fall through to bundled default
  }

  const parsed = parseChecklistText(template)
  if (parsed.length === 0) return 0

  const sectionIdByLabel: Record<string, string> = {}
  let order = 0
  for (const entry of parsed) {
    if (entry.kind !== 'section') continue
    order += 1
    try {
      const { data: sec } = await (admin as any)
        .from('diligence_checklist_items')
        .insert({
          deal_id: dealId,
          fund_id: fundId,
          parent_id: null,
          kind: 'section',
          label: entry.label,
          order_index: order,
          source: 'template',
        })
        .select('id')
        .single()
      if (sec) sectionIdByLabel[entry.label] = (sec as any).id as string
    } catch {
      // skip — partner can re-seed from the Checklist tab
    }
  }

  const itemRows = parsed
    .filter(e => e.kind === 'item')
    .map(e => {
      order += 1
      return {
        deal_id: dealId,
        fund_id: fundId,
        parent_id: sectionIdByLabel[(e as Extract<typeof e, { kind: 'item' }>).sectionLabel] ?? null,
        kind: 'item',
        label: e.label,
        order_index: order,
        source: 'template',
      }
    })

  let inserted = 0
  for (let i = 0; i < itemRows.length; i += 100) {
    const chunk = itemRows.slice(i, i + 100)
    try {
      const { error } = await (admin as any)
        .from('diligence_checklist_items')
        .insert(chunk)
      if (!error) inserted += chunk.length
    } catch {
      // continue with remaining chunks
    }
  }

  return inserted
}
