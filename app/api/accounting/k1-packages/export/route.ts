import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { refuseWithoutCarryAccess } from '@/lib/tax/access'
import { assertReadAccess } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { emptyLines, type K1Category } from '@/lib/accounting/k1-allocation'
import { buildK1Workbook, type K1WorkbookPartner } from '@/lib/tax/k1-workbook'
import { currentForm, type TaxFormRecord } from '@/lib/tax/forms'

// The K-1 package as a workbook for the preparer.
//
// Read access, not write: exporting reports what is already there. The file carries TIN last
// fours and no full numbers — see lib/tax/k1-workbook.ts.

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  // Per-partner K-1 figures include the GP's — see lib/tax/access.ts.
  const carryGate = await refuseWithoutCarryAccess(admin, gate, user.id)
  if (carryGate) return carryGate

  const limited = await rateLimit({ key: `k1-export:${user.id}`, limit: 20, windowSeconds: 300 })
  if (limited) return limited

  const packageId = req.nextUrl.searchParams.get('packageId')
  if (!packageId) return NextResponse.json({ error: 'packageId is required' }, { status: 400 })

  const { data: pkg } = await admin
    .from('k1_packages' as any)
    .select('id, vehicle_id, tax_year, version, status, fund_character, warnings')
    .eq('fund_id', gate.fundId)
    .eq('id', packageId)
    .maybeSingle()
  if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })

  const [{ data: partnerRows }, { data: lineRows }, { data: fund }, { data: vehicle }] = await Promise.all([
    admin.from('k1_partners' as any).select('*').eq('fund_id', gate.fundId).eq('package_id', packageId),
    admin.from('k1_lines' as any).select('lp_entity_id, category, amount').eq('fund_id', gate.fundId).eq('package_id', packageId),
    admin.from('funds').select('name').eq('id', gate.fundId).maybeSingle() as unknown as Promise<{ data: { name: string } | null }>,
    admin.from('fund_vehicles' as any).select('name').eq('id', (pkg as any).vehicle_id).maybeSingle(),
  ])

  const entityIds = ((partnerRows as any[]) ?? []).map(p => p.lp_entity_id)
  const [{ data: entities }, { data: forms }] = await Promise.all([
    admin.from('lp_entities' as any).select('id, entity_name').eq('fund_id', gate.fundId).in('id', entityIds),
    admin
      .from('lp_tax_forms' as any)
      .select('lp_entity_id, form_type, signed_date, expires_on, legal_name, tin_type, tin_last4, country, tax_classification')
      .eq('fund_id', gate.fundId)
      .in('lp_entity_id', entityIds.length > 0 ? entityIds : ['00000000-0000-0000-0000-000000000000']),
  ])

  const nameById = new Map(((entities as any[]) ?? []).map(e => [e.id as string, e.entity_name as string]))

  const formsByEntity = new Map<string, any[]>()
  for (const f of ((forms as any[]) ?? [])) {
    const list = formsByEntity.get(f.lp_entity_id) ?? []
    list.push(f)
    formsByEntity.set(f.lp_entity_id, list)
  }

  const linesByEntity = new Map<string, Record<K1Category, number>>()
  for (const l of ((lineRows as any[]) ?? [])) {
    const cur = linesByEntity.get(l.lp_entity_id) ?? emptyLines()
    cur[l.category as K1Category] = Number(l.amount)
    linesByEntity.set(l.lp_entity_id, cur)
  }

  const partners: K1WorkbookPartner[] = ((partnerRows as any[]) ?? []).map(p => {
    // The form details come from the CURRENT form rather than whichever row sorted first —
    // a partner who re-certified mid-year has more than one, and the K-1 carries the latest.
    const rows = formsByEntity.get(p.lp_entity_id) ?? []
    const records: (TaxFormRecord & { row: any })[] = rows.map(r => ({
      formType: r.form_type,
      signedDate: r.signed_date,
      expiresOn: r.expires_on,
      row: r,
    }))
    const cf = currentForm(records)
    return {
      lpEntityId: p.lp_entity_id,
      name: nameById.get(p.lp_entity_id) ?? p.lp_entity_id,
      legalName: cf?.row?.legal_name ?? null,
      // The package froze what the form looked like when it was built; that is what the export
      // should show, not what the form looks like today.
      formType: p.form_type ?? cf?.formType ?? null,
      formStanding: p.form_standing ?? null,
      tinType: cf?.row?.tin_type ?? null,
      tinLast4: cf?.row?.tin_last4 ?? null,
      country: cf?.row?.country ?? null,
      taxClassification: cf?.row?.tax_classification ?? null,
      lines: linesByEntity.get(p.lp_entity_id) ?? emptyLines(),
      capitalAccount: {
        beginning: Number(p.beginning_capital),
        contributions: Number(p.contributions),
        distributions: Number(p.distributions),
        netIncome: Number(p.net_income),
        ending: Number(p.ending_capital),
      },
      tieOutVariance: Number(p.tie_out_variance),
      rollForwardVariance: Number(p.roll_forward_variance),
    }
  })

  const vehicleName = (vehicle as any)?.name ?? 'Vehicle'
  const wb = buildK1Workbook({
    fundName: fund?.name ?? 'Fund',
    vehicle: vehicleName,
    taxYear: (pkg as any).tax_year,
    version: (pkg as any).version,
    status: (pkg as any).status,
    generatedAt: new Date().toISOString(),
    partners,
    fundCharacter: (pkg as any).fund_character ?? null,
    warnings: ((pkg as any).warnings ?? []) as { kind: string; detail: string }[],
  })

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const filename = `k1-${vehicleName}-${(pkg as any).tax_year}-v${(pkg as any).version}`.replace(/[^a-zA-Z0-9\-]/g, '-')
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
    },
  })
}
