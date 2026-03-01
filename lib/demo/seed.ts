import { createAdminClient } from '@/lib/supabase/admin'

const DEMO_FUND_NAME = 'Acme Ventures (Demo)'

const COMPANIES = [
  {
    name: 'NovaTech',
    stage: 'Series A',
    industry: ['SaaS'],
    metrics: [
      { name: 'Monthly Recurring Revenue', slug: 'mrr', unit: '$', unit_position: 'prefix' as const, value_type: 'currency' as const, cadence: 'monthly' as const, values: [
        { label: 'Jan 2025', year: 2025, month: 1, val: 120000 },
        { label: 'Feb 2025', year: 2025, month: 2, val: 132000 },
        { label: 'Mar 2025', year: 2025, month: 3, val: 145000 },
        { label: 'Apr 2025', year: 2025, month: 4, val: 156000 },
        { label: 'May 2025', year: 2025, month: 5, val: 168000 },
        { label: 'Jun 2025', year: 2025, month: 6, val: 179000 },
        { label: 'Jul 2025', year: 2025, month: 7, val: 192000 },
        { label: 'Aug 2025', year: 2025, month: 8, val: 201000 },
        { label: 'Sep 2025', year: 2025, month: 9, val: 215000 },
        { label: 'Oct 2025', year: 2025, month: 10, val: 228000 },
        { label: 'Nov 2025', year: 2025, month: 11, val: 240000 },
        { label: 'Dec 2025', year: 2025, month: 12, val: 258000 },
      ]},
      { name: 'Burn Rate', slug: 'burn', unit: '$', unit_position: 'prefix' as const, value_type: 'currency' as const, cadence: 'quarterly' as const, values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 85000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 92000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 88000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 95000 },
      ]},
      { name: 'Net Revenue Retention', slug: 'nrr', unit: '%', unit_position: 'suffix' as const, value_type: 'percentage' as const, cadence: 'quarterly' as const, values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 112 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 115 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 118 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 121 },
      ]},
    ],
  },
  {
    name: 'GreenLeaf Bio',
    stage: 'Seed',
    industry: ['Biotech'],
    metrics: [
      { name: 'Cash on Hand', slug: 'cash', unit: '$', unit_position: 'prefix' as const, value_type: 'currency' as const, cadence: 'quarterly' as const, values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 2400000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 2100000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 1800000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 1500000 },
      ]},
      { name: 'Headcount', slug: 'headcount', unit: null, unit_position: 'suffix' as const, value_type: 'number' as const, cadence: 'quarterly' as const, values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 8 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 10 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 12 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 14 },
      ]},
    ],
  },
  {
    name: 'UrbanFlow',
    stage: 'Series B',
    industry: ['Logistics'],
    metrics: [
      { name: 'Annual Recurring Revenue', slug: 'arr', unit: '$', unit_position: 'prefix' as const, value_type: 'currency' as const, cadence: 'quarterly' as const, values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 4200000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 4800000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 5100000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 5500000 },
      ]},
      { name: 'Gross Margin', slug: 'gross-margin', unit: '%', unit_position: 'suffix' as const, value_type: 'percentage' as const, cadence: 'quarterly' as const, values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 62 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 64 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 65 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 67 },
      ]},
      { name: 'Customer Count', slug: 'customers', unit: null, unit_position: 'suffix' as const, value_type: 'number' as const, cadence: 'quarterly' as const, values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 42 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 51 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 58 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 67 },
      ]},
    ],
  },
  {
    name: 'Marpipe',
    stage: 'Series A',
    industry: ['AdTech'],
    metrics: [
      { name: 'Monthly Recurring Revenue', slug: 'mrr', unit: '$', unit_position: 'prefix' as const, value_type: 'currency' as const, cadence: 'monthly' as const, values: [
        { label: 'Oct 2025', year: 2025, month: 10, val: 310000 },
        { label: 'Nov 2025', year: 2025, month: 11, val: 325000 },
        { label: 'Dec 2025', year: 2025, month: 12, val: 340000 },
        { label: 'Jan 2026', year: 2026, month: 1, val: 348000 },
      ]},
      { name: 'Logo Churn', slug: 'churn', unit: '%', unit_position: 'suffix' as const, value_type: 'percentage' as const, cadence: 'quarterly' as const, values: [
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 3.2 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 2.8 },
      ]},
    ],
  },
]

/** Returns true if data was newly seeded, false if already existed */
export async function seedDemoData(userId: string): Promise<boolean> {
  const admin = createAdminClient()

  // Check if demo data already exists
  const { data: existingFund } = await admin
    .from('funds')
    .select('id')
    .eq('name', DEMO_FUND_NAME)
    .maybeSingle()

  if (existingFund) return false // Already seeded

  // Create fund
  const { data: fund, error: fundError } = await admin
    .from('funds')
    .insert({ name: DEMO_FUND_NAME, created_by: userId })
    .select('id')
    .single()

  if (fundError || !fund) {
    console.error('[demo] Failed to create fund:', fundError)
    return false
  }

  // Fund_members trigger should auto-create, but ensure it exists
  await admin.from('fund_members').upsert({
    fund_id: fund.id,
    user_id: userId,
  }, { onConflict: 'fund_id,user_id' })

  // Create fund_settings (no real API key)
  await admin.from('fund_settings').insert({
    fund_id: fund.id,
    postmark_webhook_token: 'demo-token',
  })

  // Seed companies and metrics
  for (const companyData of COMPANIES) {
    const { data: company } = await admin
      .from('companies')
      .insert({
        fund_id: fund.id,
        name: companyData.name,
        stage: companyData.stage,
        industry: companyData.industry,
        status: 'active',
      })
      .select('id')
      .single()

    if (!company) continue

    for (let i = 0; i < companyData.metrics.length; i++) {
      const mDef = companyData.metrics[i]
      const { data: metric } = await admin
        .from('metrics')
        .insert({
          company_id: company.id,
          fund_id: fund.id,
          name: mDef.name,
          slug: mDef.slug,
          unit: mDef.unit,
          unit_position: mDef.unit_position,
          value_type: mDef.value_type,
          reporting_cadence: mDef.cadence,
          display_order: i,
          is_active: true,
        })
        .select('id')
        .single()

      if (!metric) continue

      for (const v of mDef.values) {
        await admin.from('metric_values').insert({
          metric_id: metric.id,
          company_id: company.id,
          fund_id: fund.id,
          period_label: v.label,
          period_year: v.year,
          period_quarter: 'quarter' in v ? (v as { quarter: number }).quarter : null,
          period_month: 'month' in v ? (v as { month: number }).month : null,
          value_number: v.val,
          confidence: 'high',
          is_manually_entered: false,
        })
      }
    }
  }

  console.log('[demo] Demo data seeded successfully')
  return true
}
