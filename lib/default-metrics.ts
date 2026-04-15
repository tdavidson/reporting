import type { ReportingCadence, ValueType } from '@/lib/types/database'

export interface DefaultMetricDef {
  name: string
  slug: string
  description: string | null
  value_type: ValueType
  unit: string | null
  unit_position: 'prefix' | 'suffix'
  reporting_cadence: ReportingCadence
  display_order: number
}

export const DEFAULT_METRICS: DefaultMetricDef[] = [
  {
    name: 'MRR',
    slug: 'mrr',
    description: 'Monthly Recurring Revenue',
    value_type: 'currency',
    unit: null,
    unit_position: 'prefix',
    reporting_cadence: 'monthly',
    display_order: 0,
  },
  {
    name: 'Cash',
    slug: 'cash',
    description: 'Cash on hand',
    value_type: 'currency',
    unit: null,
    unit_position: 'prefix',
    reporting_cadence: 'monthly',
    display_order: 1,
  },
  {
    name: 'Burn Rate',
    slug: 'burn-rate',
    description: 'Monthly net burn',
    value_type: 'currency',
    unit: null,
    unit_position: 'prefix',
    reporting_cadence: 'monthly',
    display_order: 2,
  },
  {
    name: 'Runway',
    slug: 'runway',
    description: 'Months of runway remaining',
    value_type: 'number',
    unit: 'mo',
    unit_position: 'suffix',
    reporting_cadence: 'monthly',
    display_order: 3,
  },
]

/**
 * Inserts default metrics for a company, skipping any slugs that already exist.
 * Safe to call multiple times (idempotent via slug check).
 */
export async function seedDefaultMetrics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  fundId: string,
) {
  // Fetch existing slugs for this company
  const { data: existing } = await admin
    .from('metrics')
    .select('slug')
    .eq('company_id', companyId)

  const existingSlugs = new Set((existing ?? []).map((m: { slug: string }) => m.slug))

  const toInsert = DEFAULT_METRICS
    .filter(m => !existingSlugs.has(m.slug))
    .map(m => ({
      company_id: companyId,
      fund_id: fundId,
      name: m.name,
      slug: m.slug,
      description: m.description,
      value_type: m.value_type,
      unit: m.unit,
      unit_position: m.unit_position,
      reporting_cadence: m.reporting_cadence,
      display_order: m.display_order,
      is_active: true,
      currency: null,
    }))

  if (toInsert.length === 0) return { inserted: 0 }

  const { error } = await admin.from('metrics').insert(toInsert)
  if (error) throw error

  return { inserted: toInsert.length }
}
