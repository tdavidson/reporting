import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

interface LpInvestmentDef {
  investor: string
  entity: string
  portfolio_group: string
  commitment: number
  paid_in_capital: number
  called_capital: number
  outstanding_balance: number
  distributions: number
  nav: number
  total_value: number
  dpi: number
  rvpi: number
  tvpi: number
  irr: number
}

// LP positions for Hemrock Ventures Fund I + Fund II as of 2025-12-31.
// Numbers reconcile to Fund I total commit $12M, Fund II total commit $10M
// matching the existing fund_cash_flows seed data.
const SNAPSHOT_NAME = 'Year End 2025'
const SNAPSHOT_DATE = '2025-12-31'
const SNAPSHOT_DESCRIPTION = 'Annual LP snapshot reconciled to fund cash flows and portfolio NAV. Multiples reflect Q4 2025 marks.'

const LP_INVESTMENTS: LpInvestmentDef[] = [
  // --- Fund I LPs (total commit $12M; called $10.3M; FMV $21.4M) ---
  {
    investor: 'Hemrock Founders Capital LP',
    entity: 'Hemrock Founders Capital LP',
    portfolio_group: 'Fund I',
    commitment: 4_000_000,
    paid_in_capital: 3_433_333,
    called_capital: 3_433_333,
    outstanding_balance: 566_667,
    distributions: 0,
    nav: 7_133_333,
    total_value: 7_133_333,
    dpi: 0.00,
    rvpi: 2.08,
    tvpi: 2.08,
    irr: 0.31,
  },
  {
    investor: 'Northstar Family Office',
    entity: 'Northstar Family Office I LLC',
    portfolio_group: 'Fund I',
    commitment: 3_000_000,
    paid_in_capital: 2_575_000,
    called_capital: 2_575_000,
    outstanding_balance: 425_000,
    distributions: 0,
    nav: 5_350_000,
    total_value: 5_350_000,
    dpi: 0.00,
    rvpi: 2.08,
    tvpi: 2.08,
    irr: 0.31,
  },
  {
    investor: 'Coastal University Endowment',
    entity: 'Coastal University Endowment',
    portfolio_group: 'Fund I',
    commitment: 2_500_000,
    paid_in_capital: 2_145_833,
    called_capital: 2_145_833,
    outstanding_balance: 354_167,
    distributions: 0,
    nav: 4_458_333,
    total_value: 4_458_333,
    dpi: 0.00,
    rvpi: 2.08,
    tvpi: 2.08,
    irr: 0.31,
  },
  {
    investor: 'Pinecrest Foundation',
    entity: 'Pinecrest Foundation Charitable Trust',
    portfolio_group: 'Fund I',
    commitment: 1_500_000,
    paid_in_capital: 1_287_500,
    called_capital: 1_287_500,
    outstanding_balance: 212_500,
    distributions: 0,
    nav: 2_675_000,
    total_value: 2_675_000,
    dpi: 0.00,
    rvpi: 2.08,
    tvpi: 2.08,
    irr: 0.31,
  },
  {
    investor: 'Various Angels Fund I',
    entity: 'Hemrock Angels Aggregator I LP',
    portfolio_group: 'Fund I',
    commitment: 1_000_000,
    paid_in_capital: 858_333,
    called_capital: 858_333,
    outstanding_balance: 141_667,
    distributions: 0,
    nav: 1_783_333,
    total_value: 1_783_333,
    dpi: 0.00,
    rvpi: 2.08,
    tvpi: 2.08,
    irr: 0.31,
  },

  // --- Fund II LPs (total commit $10M; called $8.5M; FMV $16.85M) ---
  {
    investor: 'Hemrock Founders Capital LP',
    entity: 'Hemrock Founders Capital LP',
    portfolio_group: 'Fund II',
    commitment: 3_500_000,
    paid_in_capital: 2_975_000,
    called_capital: 2_975_000,
    outstanding_balance: 525_000,
    distributions: 0,
    nav: 5_897_500,
    total_value: 5_897_500,
    dpi: 0.00,
    rvpi: 1.98,
    tvpi: 1.98,
    irr: 0.28,
  },
  {
    investor: 'Northstar Family Office',
    entity: 'Northstar Family Office II LLC',
    portfolio_group: 'Fund II',
    commitment: 2_500_000,
    paid_in_capital: 2_125_000,
    called_capital: 2_125_000,
    outstanding_balance: 375_000,
    distributions: 0,
    nav: 4_212_500,
    total_value: 4_212_500,
    dpi: 0.00,
    rvpi: 1.98,
    tvpi: 1.98,
    irr: 0.28,
  },
  {
    investor: 'Greenfield Pension',
    entity: 'Greenfield County Employees Pension',
    portfolio_group: 'Fund II',
    commitment: 2_000_000,
    paid_in_capital: 1_700_000,
    called_capital: 1_700_000,
    outstanding_balance: 300_000,
    distributions: 0,
    nav: 3_370_000,
    total_value: 3_370_000,
    dpi: 0.00,
    rvpi: 1.98,
    tvpi: 1.98,
    irr: 0.28,
  },
  {
    investor: 'Coastal University Endowment',
    entity: 'Coastal University Endowment',
    portfolio_group: 'Fund II',
    commitment: 1_500_000,
    paid_in_capital: 1_275_000,
    called_capital: 1_275_000,
    outstanding_balance: 225_000,
    distributions: 0,
    nav: 2_527_500,
    total_value: 2_527_500,
    dpi: 0.00,
    rvpi: 1.98,
    tvpi: 1.98,
    irr: 0.28,
  },
  {
    investor: 'Various Angels Fund II',
    entity: 'Hemrock Angels Aggregator II LP',
    portfolio_group: 'Fund II',
    commitment: 500_000,
    paid_in_capital: 425_000,
    called_capital: 425_000,
    outstanding_balance: 75_000,
    distributions: 0,
    nav: 842_500,
    total_value: 842_500,
    dpi: 0.00,
    rvpi: 1.98,
    tvpi: 1.98,
    irr: 0.28,
  },
]

export async function seedLpSnapshot(admin: Admin, fundId: string): Promise<void> {
  // Snapshot row.
  const { data: snapshot } = await admin
    .from('lp_snapshots')
    .insert({
      fund_id: fundId,
      name: SNAPSHOT_NAME,
      as_of_date: SNAPSHOT_DATE,
      description: SNAPSHOT_DESCRIPTION,
    } as any)
    .select('id')
    .single()
  if (!snapshot) return
  const snapshotId = (snapshot as any).id as string

  // Investors → entities → investments.
  const investorIdMap: Record<string, string> = {}
  const entityIdMap: Record<string, string> = {}

  // Distinct investors.
  const investors = Array.from(new Set(LP_INVESTMENTS.map(i => i.investor)))
  for (const name of investors) {
    const { data } = await admin
      .from('lp_investors')
      .insert({ fund_id: fundId, name } as any)
      .select('id')
      .single()
    if (data) investorIdMap[name] = (data as any).id
  }

  // Distinct entities.
  const seenEntities = new Set<string>()
  for (const inv of LP_INVESTMENTS) {
    if (seenEntities.has(inv.entity)) continue
    seenEntities.add(inv.entity)
    const investorId = investorIdMap[inv.investor]
    if (!investorId) continue
    const { data } = await admin
      .from('lp_entities')
      .insert({
        fund_id: fundId,
        investor_id: investorId,
        entity_name: inv.entity,
      } as any)
      .select('id')
      .single()
    if (data) entityIdMap[inv.entity] = (data as any).id
  }

  // Investments per snapshot.
  for (const inv of LP_INVESTMENTS) {
    const entityId = entityIdMap[inv.entity]
    if (!entityId) continue
    await admin.from('lp_investments').insert({
      fund_id: fundId,
      entity_id: entityId,
      portfolio_group: inv.portfolio_group,
      commitment: inv.commitment,
      paid_in_capital: inv.paid_in_capital,
      called_capital: inv.called_capital,
      outstanding_balance: inv.outstanding_balance,
      distributions: inv.distributions,
      nav: inv.nav,
      total_value: inv.total_value,
      dpi: inv.dpi,
      rvpi: inv.rvpi,
      tvpi: inv.tvpi,
      irr: inv.irr,
      snapshot_id: snapshotId,
    } as any)
  }
}
