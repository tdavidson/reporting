/**
 * Export the demo fund into demo-widget/data/snapshot.json.
 *
 *   DEMO_FUND_NAME="OtherAdmin Demo" npx tsx scripts/demo-snapshot.ts
 *
 * Runs against the database in .env.local (service role), reads only the one fund, and writes
 * the shape demo-widget/types.ts describes. Commit the result; CI builds the widget from it.
 * The fund's own name is replaced by DEMO_FUND_LABEL (default "OtherAdmin Demo") so the public
 * widget never carries whatever the install happens to call it.
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEMO_SCHEMA_VERSION, type DemoSnapshot } from '@/demo-widget/types'

const FUND_NAME = process.env.DEMO_FUND_NAME ?? 'OtherAdmin Demo'
const FUND_LABEL = process.env.DEMO_FUND_LABEL ?? 'OtherAdmin Demo'
const OUT = path.join(process.cwd(), 'demo-widget', 'data', 'snapshot.json')

async function main() {
  const admin = createAdminClient()
  const { data: fund, error } = await admin.from('funds').select('id, name, currency').eq('name', FUND_NAME).maybeSingle()
  if (error) throw error
  if (!fund) throw new Error(`No fund named ${JSON.stringify(FUND_NAME)}. Set DEMO_FUND_NAME.`)
  const fundId = fund.id

  const [vehicles, companies, metrics, values, lps, deals, notes, interactions, investments] = await Promise.all([
    // fund_vehicles is not in the generated Database type yet; the rest of the codebase casts too.
    (admin as any).from('fund_vehicles').select('id, name, kind').eq('fund_id', fundId).order('name') as Promise<{ data: { id: string; name: string; kind: string | null }[] | null; error: unknown }>,
    admin.from('companies').select('id, name, aliases, industry, stage, status, overview, founders, why_invested, portfolio_group').eq('fund_id', fundId).order('name'),
    admin.from('metrics').select('id, company_id, name, slug, unit, unit_position, value_type, reporting_cadence, display_order').eq('fund_id', fundId).eq('is_active', true).order('display_order'),
    admin.from('metric_values').select('metric_id, period_label, period_year, period_quarter, period_month, value_number').eq('fund_id', fundId)
      .order('period_year').order('period_quarter').order('period_month'),
    admin.from('lp_investors').select('id, name').eq('fund_id', fundId).order('name'),
    admin.from('inbound_deals').select('id, company_name, founder_name, status, stage, industry, raise_amount, intro_source, thesis_fit_score, company_summary, thesis_fit_analysis').eq('fund_id', fundId).order('created_at', { ascending: false }).limit(20),
    admin.from('company_notes').select('id, company_id, content, created_at').eq('fund_id', fundId).order('created_at', { ascending: false }).limit(30),
    admin.from('interactions').select('company_id, subject, summary, interaction_date').eq('fund_id', fundId).order('interaction_date', { ascending: false }).limit(30),
    admin.from('investment_transactions').select('company_id, portfolio_group, transaction_type, transaction_date, round_name, investment_cost, share_price, unrealized_value_change, current_share_price, notes').eq('fund_id', fundId).order('transaction_date'),
  ])
  for (const r of [vehicles, companies, metrics, values, lps, deals, notes, interactions, investments]) if (r.error) throw r.error

  const valuesByMetric = new Map<string, DemoSnapshot['companies'][number]['metrics'][number]['values']>()
  for (const v of values.data ?? []) {
    const list = valuesByMetric.get(v.metric_id) ?? []
    list.push({ period_label: v.period_label, year: v.period_year, quarter: v.period_quarter, month: v.period_month, number: v.value_number })
    valuesByMetric.set(v.metric_id, list)
  }

  const snapshot: DemoSnapshot = {
    schemaVersion: DEMO_SCHEMA_VERSION,
    generatedAt: new Date().toISOString().slice(0, 10),
    source: `${fund.name} (demo fund)`,
    fund: { name: FUND_LABEL, currency: fund.currency ?? 'USD' },
    vehicles: (vehicles.data ?? []).map(v => ({ id: v.id, name: v.name, kind: v.kind ?? null })),
    companies: (companies.data ?? []).map(c => ({
      id: c.id, name: c.name, aliases: c.aliases, industry: c.industry, stage: c.stage, status: c.status ?? 'active',
      overview: c.overview, founders: c.founders, why_invested: c.why_invested, portfolio_group: c.portfolio_group,
      metrics: (metrics.data ?? []).filter(m => m.company_id === c.id).map(m => ({
        id: m.id, company_id: m.company_id, name: m.name, slug: m.slug, unit: m.unit, unit_position: m.unit_position ?? 'prefix',
        value_type: m.value_type ?? 'number', cadence: m.reporting_cadence ?? 'quarterly', display_order: m.display_order ?? 0,
        values: valuesByMetric.get(m.id) ?? [],
      })),
    })),
    lps: (lps.data ?? []).map(l => ({ id: l.id, name: l.name })),
    deals: (deals.data ?? []).map(d => ({ ...d })),
    notes: (notes.data ?? []).map(n => ({ id: n.id, company_id: n.company_id, content: n.content, created_at: String(n.created_at).slice(0, 10) })),
    interactions: (interactions.data ?? []).map(i => ({ company_id: i.company_id, subject: i.subject ?? '', summary: i.summary ?? '', date: String(i.interaction_date).slice(0, 10) })),
    investments: (investments.data ?? []).map(t => ({
      company_id: t.company_id, vehicle: t.portfolio_group ?? '', type: t.transaction_type, date: t.transaction_date ?? '',
      ...(t.round_name ? { round: t.round_name } : {}),
      ...(t.investment_cost != null ? { cost: t.investment_cost } : {}),
      ...(t.share_price != null ? { share_price: t.share_price } : {}),
      ...(t.unrealized_value_change != null ? { unrealized_change: t.unrealized_value_change } : {}),
      ...(t.current_share_price != null ? { mark_share_price: t.current_share_price } : {}),
      ...(t.notes ? { note: t.notes } : {}),
    })),
  }

  writeFileSync(OUT, JSON.stringify(snapshot, null, 1) + '\n')
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}: ${snapshot.companies.length} companies, ${snapshot.companies.reduce((n, c) => n + c.metrics.length, 0)} metrics, ${snapshot.deals.length} deals`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
