import { createAdminClient } from '@/lib/supabase/admin'
import { seedInboundDeals, DEMO_DEAL_THESIS } from './seed-deals'
import { seedDiligence } from './seed-diligence'
import { seedLpSnapshot } from './seed-lps'

const DEMO_FUND_NAME = 'Hemrock Ventures'

type MetricDef = {
  name: string
  slug: string
  unit: string | null
  unit_position: 'prefix' | 'suffix'
  value_type: 'currency' | 'percentage' | 'number' | 'text'
  cadence: 'monthly' | 'quarterly' | 'annual'
  values: Array<{
    label: string
    year: number
    quarter?: number
    month?: number
    val: number
  }>
}

type CompanyDef = {
  name: string
  stage: string
  industry: string[]
  group: string
  overview: string
  founders: string
  why_invested: string
  contact_email: string[]
  metrics: MetricDef[]
}

const COMPANIES: CompanyDef[] = [
  {
    name: 'NovaTech',
    stage: 'Series A',
    industry: ['SaaS'],
    group: 'Fund I',
    overview: 'AI-powered customer success platform helping B2B SaaS companies reduce churn and expand accounts.',
    founders: 'Sarah Chen, Marcus Rivera',
    why_invested: 'Strong product-market fit in a growing category with exceptional net retention metrics.',
    contact_email: ['sarah@novatech.io'],
    metrics: [
      { name: 'Monthly Recurring Revenue', slug: 'mrr', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'monthly', values: [
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
      { name: 'Burn Rate', slug: 'burn', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 85000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 92000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 88000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 95000 },
      ]},
      { name: 'Net Revenue Retention', slug: 'nrr', unit: '%', unit_position: 'suffix', value_type: 'percentage', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 112 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 115 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 118 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 121 },
      ]},
      { name: 'Cash on Hand', slug: 'cash', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 3200000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 2900000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 2600000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 2400000 },
      ]},
    ],
  },
  {
    name: 'GreenLeaf Bio',
    stage: 'Seed',
    industry: ['Biotech'],
    group: 'Fund I',
    overview: 'Developing sustainable bio-based alternatives to petroleum-derived packaging materials.',
    founders: 'Dr. Priya Patel',
    why_invested: 'Breakthrough polymer technology with strong IP moat and massive market opportunity.',
    contact_email: ['priya@greenleafbio.com'],
    metrics: [
      { name: 'Cash on Hand', slug: 'cash', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 2400000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 2100000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 1800000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 1500000 },
      ]},
      { name: 'Headcount', slug: 'headcount', unit: null, unit_position: 'suffix', value_type: 'number', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 8 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 10 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 12 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 14 },
      ]},
    ],
  },
  {
    name: 'RouteWise',
    stage: 'Series B',
    industry: ['Logistics', 'SaaS'],
    group: 'Fund I',
    overview: 'Last-mile delivery optimization platform used by enterprise retailers and logistics providers.',
    founders: 'James Okafor, Lin Wei',
    why_invested: 'Category leader in a $40B TAM with sticky enterprise contracts and strong unit economics.',
    contact_email: ['james@routewise.co', 'lin@routewise.co'],
    metrics: [
      { name: 'Annual Recurring Revenue', slug: 'arr', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 4200000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 4800000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 5100000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 5500000 },
        { label: 'Q1 2026', year: 2026, quarter: 1, val: 6100000 },
      ]},
      { name: 'Gross Margin', slug: 'gross-margin', unit: '%', unit_position: 'suffix', value_type: 'percentage', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 62 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 64 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 65 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 67 },
        { label: 'Q1 2026', year: 2026, quarter: 1, val: 68 },
      ]},
      { name: 'Customer Count', slug: 'customers', unit: null, unit_position: 'suffix', value_type: 'number', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 42 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 51 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 58 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 67 },
        { label: 'Q1 2026', year: 2026, quarter: 1, val: 74 },
      ]},
    ],
  },
  {
    name: 'AdVantage',
    stage: 'Series A',
    industry: ['AdTech'],
    group: 'Fund I',
    overview: 'Multivariate creative testing platform that automates ad creative optimization at scale.',
    founders: 'Jamie Lin, Alex Torres',
    why_invested: 'Unique creative-first approach to ad optimization with rapid adoption among performance marketers.',
    contact_email: ['jamie@advantage.io'],
    metrics: [
      { name: 'Monthly Recurring Revenue', slug: 'mrr', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'monthly', values: [
        { label: 'Jul 2025', year: 2025, month: 7, val: 280000 },
        { label: 'Aug 2025', year: 2025, month: 8, val: 295000 },
        { label: 'Sep 2025', year: 2025, month: 9, val: 305000 },
        { label: 'Oct 2025', year: 2025, month: 10, val: 310000 },
        { label: 'Nov 2025', year: 2025, month: 11, val: 325000 },
        { label: 'Dec 2025', year: 2025, month: 12, val: 340000 },
        { label: 'Jan 2026', year: 2026, month: 1, val: 348000 },
      ]},
      { name: 'Logo Churn', slug: 'churn', unit: '%', unit_position: 'suffix', value_type: 'percentage', cadence: 'quarterly', values: [
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 3.5 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 3.2 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 2.8 },
      ]},
    ],
  },
  {
    name: 'Verdant',
    stage: 'Seed',
    industry: ['Climate Tech'],
    group: 'Fund II',
    overview: 'Carbon accounting and offset management platform for mid-market enterprises.',
    founders: 'Anna Kowalski, Raj Mehta',
    why_invested: 'Regulatory tailwinds (CSRD, SEC climate rules) create strong demand pull for compliance tooling.',
    contact_email: ['anna@verdant.earth'],
    metrics: [
      { name: 'Cash on Hand', slug: 'cash', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 1800000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 1550000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 1300000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 1100000 },
      ]},
      { name: 'Monthly Burn', slug: 'burn', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 72000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 80000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 78000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 85000 },
      ]},
      { name: 'Grant Revenue', slug: 'grants', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'quarterly', values: [
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 150000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 200000 },
      ]},
    ],
  },
  {
    name: 'TapFin',
    stage: 'Series A',
    industry: ['Fintech'],
    group: 'Fund II',
    overview: 'Embedded payments infrastructure for African merchants, processing card, mobile money, and bank transfers.',
    founders: 'Kemi Adeyemi, Tobi Mensah',
    why_invested: 'First-mover in a rapidly digitizing payments market with 50M+ potential merchants.',
    contact_email: ['kemi@tapfin.ng'],
    metrics: [
      { name: 'Gross Merchandise Volume', slug: 'gmv', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'monthly', values: [
        { label: 'Jul 2025', year: 2025, month: 7, val: 12000000 },
        { label: 'Aug 2025', year: 2025, month: 8, val: 13500000 },
        { label: 'Sep 2025', year: 2025, month: 9, val: 14200000 },
        { label: 'Oct 2025', year: 2025, month: 10, val: 15800000 },
        { label: 'Nov 2025', year: 2025, month: 11, val: 17100000 },
        { label: 'Dec 2025', year: 2025, month: 12, val: 19500000 },
        { label: 'Jan 2026', year: 2026, month: 1, val: 18200000 },
      ]},
      { name: 'Revenue', slug: 'revenue', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'monthly', values: [
        { label: 'Jul 2025', year: 2025, month: 7, val: 180000 },
        { label: 'Aug 2025', year: 2025, month: 8, val: 202000 },
        { label: 'Sep 2025', year: 2025, month: 9, val: 213000 },
        { label: 'Oct 2025', year: 2025, month: 10, val: 237000 },
        { label: 'Nov 2025', year: 2025, month: 11, val: 256000 },
        { label: 'Dec 2025', year: 2025, month: 12, val: 292000 },
        { label: 'Jan 2026', year: 2026, month: 1, val: 273000 },
      ]},
      { name: 'Take Rate', slug: 'take-rate', unit: '%', unit_position: 'suffix', value_type: 'percentage', cadence: 'quarterly', values: [
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 1.5 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 1.5 },
      ]},
      { name: 'Cash on Hand', slug: 'cash', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 4100000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 3700000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 3400000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 3200000 },
      ]},
    ],
  },
  {
    name: 'Benchline',
    stage: 'Series B',
    industry: ['Data Analytics'],
    group: 'Fund II',
    overview: 'Real-time operational benchmarking platform for SaaS companies comparing against anonymized peer data.',
    founders: 'Emily Zhang, Tom Hartley',
    why_invested: 'Network effects compound as more companies join, creating a unique data moat.',
    contact_email: ['emily@benchline.com', 'tom@benchline.com'],
    metrics: [
      { name: 'Annual Recurring Revenue', slug: 'arr', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 7800000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 8500000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 9200000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 10100000 },
        { label: 'Q1 2026', year: 2026, quarter: 1, val: 10800000 },
      ]},
      { name: 'Net Dollar Retention', slug: 'ndr', unit: '%', unit_position: 'suffix', value_type: 'percentage', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 125 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 128 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 130 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 127 },
      ]},
      { name: 'Headcount', slug: 'headcount', unit: null, unit_position: 'suffix', value_type: 'number', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 45 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 52 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 58 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 62 },
      ]},
      { name: 'Cash on Hand', slug: 'cash', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 18000000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 16500000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 15200000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 14000000 },
      ]},
    ],
  },
  {
    name: 'Lattis',
    stage: 'Pre-Seed',
    industry: ['AI / ML'],
    group: 'Fund II',
    overview: 'Open-source vector embedding framework for multimodal retrieval-augmented generation pipelines.',
    founders: 'Elena Vasquez',
    why_invested: 'Strong open-source traction and early enterprise adoption for AI search infrastructure.',
    contact_email: ['elena@lattis.dev'],
    metrics: [
      { name: 'Cash on Hand', slug: 'cash', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 900000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 780000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 650000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 520000 },
      ]},
      { name: 'Monthly Burn', slug: 'burn', unit: '$', unit_position: 'prefix', value_type: 'currency', cadence: 'quarterly', values: [
        { label: 'Q1 2025', year: 2025, quarter: 1, val: 38000 },
        { label: 'Q2 2025', year: 2025, quarter: 2, val: 42000 },
        { label: 'Q3 2025', year: 2025, quarter: 3, val: 45000 },
        { label: 'Q4 2025', year: 2025, quarter: 4, val: 48000 },
      ]},
    ],
  },
]

const SUMMARIES: Record<string, string> = {
  NovaTech: `NovaTech continues to execute well with MRR reaching $258K in December, representing 115% year-over-year growth. Net revenue retention of 121% is exceptional and indicates strong product-market fit. The burn rate remains manageable at ~$95K/quarter, giving the company approximately 7 quarters of runway at current pace.

Key concern: the burn rate has been creeping up and should be monitored. The team should consider whether the current growth trajectory justifies the increased spend or if there are efficiency gains to capture. Overall, NovaTech remains one of the strongest performers in the portfolio.`,

  RouteWise: `RouteWise closed Q1 2026 with $6.1M ARR, up 45% year-over-year. The company continues to add enterprise customers at a healthy pace (74 as of Q1 2026), and gross margins have expanded to 68%. The business is approaching cash flow breakeven as unit economics improve.

The expansion from logistics into retail fulfillment is showing early traction, with 8 new retail customers signed in Q4. This vertical diversification reduces concentration risk. Recommend discussing Series C timeline at the next board meeting.`,

  Benchline: `Benchline crossed the $10M ARR milestone in Q4 2025, driven by strong net dollar retention of 127%. The company added 10 new enterprise customers in Q4 and is seeing accelerating inbound interest from PE-backed SaaS companies looking for operational benchmarks.

Headcount grew to 62, primarily in engineering and customer success. Cash position remains strong at $14M, providing 18+ months of runway. The network effect thesis is playing out as planned — each new customer makes the dataset more valuable for all participants.`,

  TapFin: `TapFin processed $19.5M in GMV in December 2025, a seasonal high driven by holiday spending. Revenue scaled proportionally to $292K. The 1.5% take rate remains stable and in line with regional benchmarks.

Cash position of $3.2M at year-end provides roughly 12 months of runway at current burn. The team should begin Series B discussions in Q2 2026. Key risk: currency volatility in core markets continues to create FX headwinds on USD-reported metrics.`,
}

const NOTES = [
  { companyName: null, content: 'Q4 portfolio review scheduled for March 15. Need updated financials from all companies by March 1.' },
  { companyName: 'NovaTech', content: 'Sarah mentioned they are exploring a strategic partnership with Salesforce. Follow up in next 1:1.' },
  { companyName: 'RouteWise', content: 'Board meeting recap: team presented Series C readiness plan. Targeting Q3 2026 raise at $50M+ valuation.' },
  { companyName: 'GreenLeaf Bio', content: 'FDA pre-submission meeting went well. Team expects to file for regulatory clearance in Q2 2026.' },
  { companyName: null, content: 'LP update call next Thursday. Prepare portfolio summary with highlights from Benchline and RouteWise.' },
  { companyName: 'Lattis', content: 'GitHub stars passed 5K. Elena is presenting at NeurIPS next month — great visibility for enterprise pipeline.' },
]

const INBOUND_EMAILS = [
  { from: 'sarah@novatech.io', subject: 'NovaTech December 2025 Update', companyName: 'NovaTech', metrics_extracted: 4, days_ago: 12 },
  { from: 'james@routewise.co', subject: 'RouteWise Q1 2026 Quarterly Report', companyName: 'RouteWise', metrics_extracted: 3, days_ago: 5 },
  { from: 'emily@benchline.com', subject: 'Benchline Q4 2025 Board Deck', companyName: 'Benchline', metrics_extracted: 4, days_ago: 20 },
  { from: 'kemi@tapfin.ng', subject: 'TapFin January 2026 Metrics', companyName: 'TapFin', metrics_extracted: 3, days_ago: 8 },
]

const REVIEW_ITEMS = [
  { issue_type: 'low_confidence', extracted_value: '340000', companyName: 'AdVantage', metricSlug: 'mrr' },
  { issue_type: 'duplicate_period', extracted_value: '5500000', companyName: 'RouteWise', metricSlug: 'arr' },
  { issue_type: 'ambiguous_period', extracted_value: '292000', companyName: 'TapFin', metricSlug: 'revenue' },
]

const DOCUMENTS = [
  { companyName: 'NovaTech', filename: 'NovaTech_Board_Deck_Q4_2025.pdf', file_type: 'application/pdf', file_size: 2400000 },
  { companyName: 'RouteWise', filename: 'RouteWise_Financial_Model_2026.xlsx', file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', file_size: 890000 },
  { companyName: 'Benchline', filename: 'Benchline_Series_B_Memo.pdf', file_type: 'application/pdf', file_size: 1500000 },
  { companyName: 'Verdant', filename: 'Verdant_IP_Overview.pdf', file_type: 'application/pdf', file_size: 650000 },
]

type InvestmentDef = {
  companyName: string
  transaction_type: 'investment' | 'proceeds' | 'unrealized_gain_change'
  round_name?: string
  transaction_date: string
  portfolio_group?: string
  notes?: string
  investment_cost?: number
  shares_acquired?: number
  share_price?: number
  unrealized_value_change?: number
  current_share_price?: number
  cost_basis_exited?: number
  proceeds_received?: number
}

const INVESTMENTS: InvestmentDef[] = [
  // NovaTech — Seed + Series A (Fund I)
  { companyName: 'NovaTech', transaction_type: 'investment', round_name: 'Seed', transaction_date: '2023-06-15', portfolio_group: 'Fund I', investment_cost: 500000, shares_acquired: 500000, share_price: 1.00, notes: 'Led seed round' },
  { companyName: 'NovaTech', transaction_type: 'investment', round_name: 'Series A', transaction_date: '2024-09-01', portfolio_group: 'Fund I', investment_cost: 1500000, shares_acquired: 750000, share_price: 2.00, notes: 'Pro-rata follow-on' },
  { companyName: 'NovaTech', transaction_type: 'unrealized_gain_change', transaction_date: '2025-12-31', portfolio_group: 'Fund I', unrealized_value_change: 2500000, current_share_price: 3.60, notes: 'Q4 2025 mark based on Series A+ term sheet' },

  // GreenLeaf Bio — Seed (Fund I)
  { companyName: 'GreenLeaf Bio', transaction_type: 'investment', round_name: 'Seed', transaction_date: '2024-01-10', portfolio_group: 'Fund I', investment_cost: 750000, shares_acquired: 750000, share_price: 1.00, notes: 'Co-led seed with BioFund Partners' },
  { companyName: 'GreenLeaf Bio', transaction_type: 'unrealized_gain_change', transaction_date: '2025-12-31', portfolio_group: 'Fund I', unrealized_value_change: 250000, current_share_price: 1.33, notes: 'Modest mark-up based on grant milestones' },

  // RouteWise — Seed + Series A + Series B (Fund I)
  { companyName: 'RouteWise', transaction_type: 'investment', round_name: 'Seed', transaction_date: '2022-03-20', portfolio_group: 'Fund I', investment_cost: 400000, shares_acquired: 400000, share_price: 1.00 },
  { companyName: 'RouteWise', transaction_type: 'investment', round_name: 'Series A', transaction_date: '2023-07-15', portfolio_group: 'Fund I', investment_cost: 1000000, shares_acquired: 333333, share_price: 3.00, notes: 'Full pro-rata' },
  { companyName: 'RouteWise', transaction_type: 'investment', round_name: 'Series B', transaction_date: '2024-11-01', portfolio_group: 'Fund I', investment_cost: 2000000, shares_acquired: 285714, share_price: 7.00, notes: 'Led Series B' },
  { companyName: 'RouteWise', transaction_type: 'unrealized_gain_change', transaction_date: '2025-12-31', portfolio_group: 'Fund I', unrealized_value_change: 6800000, current_share_price: 12.50, notes: 'Q4 2025 409A valuation' },

  // AdVantage — Series A (Fund I)
  { companyName: 'AdVantage', transaction_type: 'investment', round_name: 'Series A', transaction_date: '2024-06-01', portfolio_group: 'Fund I', investment_cost: 2000000, shares_acquired: 800000, share_price: 2.50, notes: 'Co-invested with Growth Capital' },
  { companyName: 'AdVantage', transaction_type: 'unrealized_gain_change', transaction_date: '2025-12-31', portfolio_group: 'Fund I', unrealized_value_change: 1200000, current_share_price: 4.00, notes: 'Based on latest revenue multiple' },

  // Verdant — Seed (Fund II)
  { companyName: 'Verdant', transaction_type: 'investment', round_name: 'Seed', transaction_date: '2024-04-15', portfolio_group: 'Fund II', investment_cost: 600000, shares_acquired: 600000, share_price: 1.00, notes: 'Led seed round' },

  // TapFin — Seed + Series A (Fund II)
  { companyName: 'TapFin', transaction_type: 'investment', round_name: 'Seed', transaction_date: '2023-09-01', portfolio_group: 'Fund II', investment_cost: 350000, shares_acquired: 350000, share_price: 1.00 },
  { companyName: 'TapFin', transaction_type: 'investment', round_name: 'Series A', transaction_date: '2024-12-01', portfolio_group: 'Fund II', investment_cost: 1500000, shares_acquired: 500000, share_price: 3.00, notes: 'Co-led with Fintech Africa' },
  { companyName: 'TapFin', transaction_type: 'unrealized_gain_change', transaction_date: '2025-12-31', portfolio_group: 'Fund II', unrealized_value_change: 2100000, current_share_price: 5.65, notes: 'Mark based on GMV growth trajectory' },

  // Benchline — Seed + Series A + Series B (Fund II)
  { companyName: 'Benchline', transaction_type: 'investment', round_name: 'Seed', transaction_date: '2022-01-15', portfolio_group: 'Fund II', investment_cost: 300000, shares_acquired: 300000, share_price: 1.00 },
  { companyName: 'Benchline', transaction_type: 'investment', round_name: 'Series A', transaction_date: '2023-04-01', portfolio_group: 'Fund II', investment_cost: 1200000, shares_acquired: 300000, share_price: 4.00, notes: 'Full pro-rata' },
  { companyName: 'Benchline', transaction_type: 'investment', round_name: 'Series B', transaction_date: '2024-08-01', portfolio_group: 'Fund II', investment_cost: 2500000, shares_acquired: 250000, share_price: 10.00, notes: 'Led Series B at $85M pre' },
  { companyName: 'Benchline', transaction_type: 'unrealized_gain_change', transaction_date: '2025-12-31', portfolio_group: 'Fund II', unrealized_value_change: 9500000, current_share_price: 18.82, notes: 'Q4 2025 mark based on $10M ARR milestone' },

  // Lattis — Pre-Seed (Fund II)
  { companyName: 'Lattis', transaction_type: 'investment', round_name: 'Pre-Seed', transaction_date: '2024-08-15', portfolio_group: 'Fund II', investment_cost: 250000, shares_acquired: 250000, share_price: 1.00, notes: 'Angel round' },
]

type FundCashFlowDef = {
  portfolio_group: string
  flow_date: string
  flow_type: 'commitment' | 'called_capital' | 'distribution'
  amount: number
  notes?: string
}

const FUND_CASH_FLOWS: FundCashFlowDef[] = [
  // ---------------------------------------------------------------------------
  // Fund I — $12M commitment, deployed $8.15M across 4 companies
  //   RouteWise:  Seed $400K (Mar 2022) + Series A $1M (Jul 2023) + Series B $2M (Nov 2024)
  //   NovaTech:   Seed $500K (Jun 2023) + Series A $1.5M (Sep 2024)
  //   GreenLeaf:  Seed $750K (Jan 2024)
  //   AdVantage:  Series A $2M (Jun 2024)
  // ---------------------------------------------------------------------------
  { portfolio_group: 'Fund I', flow_date: '2022-01-15', flow_type: 'commitment', amount: 12000000, notes: 'Fund I final close — $12M committed' },
  { portfolio_group: 'Fund I', flow_date: '2022-03-15', flow_type: 'called_capital', amount: 500000, notes: 'Capital call #1 — RouteWise Seed ($400K) + mgmt fee reserve' },
  { portfolio_group: 'Fund I', flow_date: '2023-06-10', flow_type: 'called_capital', amount: 1800000, notes: 'Capital call #2 — NovaTech Seed ($500K), RouteWise Series A ($1M), fees' },
  { portfolio_group: 'Fund I', flow_date: '2024-01-05', flow_type: 'called_capital', amount: 1000000, notes: 'Capital call #3 — GreenLeaf Bio Seed ($750K) + reserves' },
  { portfolio_group: 'Fund I', flow_date: '2024-06-01', flow_type: 'called_capital', amount: 2500000, notes: 'Capital call #4 — AdVantage Series A ($2M) + reserves' },
  { portfolio_group: 'Fund I', flow_date: '2024-09-01', flow_type: 'called_capital', amount: 2000000, notes: 'Capital call #5 — NovaTech Series A follow-on ($1.5M) + reserves' },
  { portfolio_group: 'Fund I', flow_date: '2024-11-01', flow_type: 'called_capital', amount: 2500000, notes: 'Capital call #6 — RouteWise Series B ($2M) + reserves' },

  // ---------------------------------------------------------------------------
  // Fund II — $10M commitment, deployed $6.7M across 4 companies
  //   Benchline:  Seed $300K (Jan 2022) + Series A $1.2M (Apr 2023) + Series B $2.5M (Aug 2024)
  //   TapFin:     Seed $350K (Sep 2023) + Series A $1.5M (Dec 2024)
  //   Verdant:    Seed $600K (Apr 2024)
  //   Lattis:     Pre-Seed $250K (Aug 2024)
  // ---------------------------------------------------------------------------
  { portfolio_group: 'Fund II', flow_date: '2021-11-01', flow_type: 'commitment', amount: 10000000, notes: 'Fund II final close — $10M committed' },
  { portfolio_group: 'Fund II', flow_date: '2022-01-10', flow_type: 'called_capital', amount: 500000, notes: 'Capital call #1 — Benchline Seed ($300K) + mgmt fee reserve' },
  { portfolio_group: 'Fund II', flow_date: '2023-04-01', flow_type: 'called_capital', amount: 1800000, notes: 'Capital call #2 — Benchline Series A ($1.2M), TapFin Seed ($350K), fees' },
  { portfolio_group: 'Fund II', flow_date: '2024-04-15', flow_type: 'called_capital', amount: 1200000, notes: 'Capital call #3 — Verdant Seed ($600K) + reserves' },
  { portfolio_group: 'Fund II', flow_date: '2024-08-01', flow_type: 'called_capital', amount: 3200000, notes: 'Capital call #4 — Benchline Series B ($2.5M), Lattis Pre-Seed ($250K), reserves' },
  { portfolio_group: 'Fund II', flow_date: '2024-12-01', flow_type: 'called_capital', amount: 1800000, notes: 'Capital call #5 — TapFin Series A ($1.5M) + reserves' },
]

type InteractionDef = {
  companyName: string | null
  tags: string[]
  subject: string
  summary: string
  body_preview: string
  intro_contacts?: Array<{ name: string; email: string; context: string }>
  days_ago: number
}

const INTERACTIONS: InteractionDef[] = [
  {
    companyName: 'NovaTech',
    tags: [],
    subject: 'Re: Q4 board prep',
    summary: 'Sarah shared draft board deck and asked for feedback on the ARR bridge slide. Discussed hiring plan for Q1 and whether to bring on a VP Sales now or wait until Series A+ closes.',
    body_preview: 'Hi Taylor, attaching the draft board deck for Q4. Would love your feedback on the ARR bridge — we debated internally whether to show net new vs. expansion separately...',
    days_ago: 15,
  },
  {
    companyName: 'NovaTech',
    tags: ['intro'],
    subject: 'Intro: Sarah Chen <> David Park (VP Sales, AcmeCorp)',
    summary: 'Introduction between Sarah Chen (NovaTech CEO) and David Park (VP Sales at AcmeCorp) to discuss enterprise sales motion and playbook for scaling from $3M to $10M ARR.',
    body_preview: 'Sarah, David — connecting you two as discussed. David has scaled AcmeCorp\'s mid-market sales team from 5 to 50 reps and has great perspective on the $3-10M ARR journey...',
    intro_contacts: [
      { name: 'David Park', email: 'david.park@acmecorp.example.com', context: 'VP Sales at AcmeCorp, experienced in scaling mid-market sales teams' },
    ],
    days_ago: 22,
  },
  {
    companyName: 'RouteWise',
    tags: [],
    subject: 'Series C timing discussion',
    summary: 'James wants to start Series C conversations in Q3 2026. Discussed target raise ($30-40M), potential leads (a]6z, Coatue), and whether to hire a CFO before the process.',
    body_preview: 'Taylor, wanted to get your thoughts on timing for the C. We are tracking toward $8M ARR by mid-year and think that puts us in a strong position...',
    days_ago: 8,
  },
  {
    companyName: 'RouteWise',
    tags: ['intro'],
    subject: 'Intro: James Okafor <> Maria Santos (COO, GlobalFreight)',
    summary: 'Introduction between James Okafor (RouteWise CEO) and Maria Santos (COO at GlobalFreight) to explore potential partnership for last-mile delivery optimization.',
    body_preview: 'James, Maria — making this intro as promised. Maria\'s team at GlobalFreight is looking at last-mile optimization partners and I think there could be a strong fit...',
    intro_contacts: [
      { name: 'Maria Santos', email: 'maria.santos@globalfreight.example.com', context: 'COO at GlobalFreight, exploring last-mile delivery partnerships' },
    ],
    days_ago: 35,
  },
  {
    companyName: 'Benchline',
    tags: [],
    subject: 'Re: Customer expansion update',
    summary: 'Emily shared that three large enterprise prospects are in late-stage trials. Discussed pricing strategy for annual contracts above $200K and whether to offer multi-year discounts.',
    body_preview: 'Quick update — we have three large accounts all in week 3 of their trials. Usage metrics look strong across all three. Wanted to discuss pricing...',
    days_ago: 11,
  },
  {
    companyName: 'TapFin',
    tags: [],
    subject: 'FX hedging strategy',
    summary: 'Kemi flagged Naira volatility impacting USD-reported metrics. Discussed hedging options and whether to open a USD treasury account for operational reserves.',
    body_preview: 'Taylor, the Naira moved 8% against USD this month which is creating noise in our reported numbers. We want to discuss opening a USD account...',
    days_ago: 18,
  },
  {
    companyName: 'TapFin',
    tags: ['intro'],
    subject: 'Intro: Kemi Adeyemi <> Rachel Kim (PayBridge)',
    summary: 'Connected Kemi with Rachel Kim from PayBridge to discuss cross-border payment infrastructure and potential integration for TapFin\'s merchant onboarding flow.',
    body_preview: 'Kemi, Rachel — making this intro. Rachel runs partnerships at PayBridge and I think there is a natural fit with TapFin\'s merchant onboarding...',
    intro_contacts: [
      { name: 'Rachel Kim', email: 'rachel@paybridge.example.com', context: 'Head of Partnerships at PayBridge, focused on emerging market payment infrastructure' },
    ],
    days_ago: 40,
  },
  {
    companyName: 'Verdant',
    tags: [],
    subject: 'Grant application update',
    summary: 'Anna confirmed DOE grant application submitted. $500K grant decision expected Q2. Also discussed adding a sales hire to target CSRD-affected European companies.',
    body_preview: 'Hi Taylor, good news — we submitted the DOE SBIR Phase II application on Friday. The review committee decisions should come out by end of Q2...',
    days_ago: 25,
  },
  {
    companyName: 'Lattis',
    tags: ['intro'],
    subject: 'Intro: Elena Vasquez <> Chris Nguyen (CTO, ApexData)',
    summary: 'Introduction between Elena Vasquez (Lattis founder) and Chris Nguyen (CTO at ApexData) to discuss potential design partnership on multimodal embeddings for enterprise RAG use cases.',
    body_preview: 'Elena, Chris — connecting you two. Chris\'s team at ApexData is working on multimodal data pipelines and I think Lattis\'s embedding framework could be a great fit...',
    intro_contacts: [
      { name: 'Chris Nguyen', email: 'chris.nguyen@apexdata.example.com', context: 'CTO at ApexData, working on multimodal data pipelines for enterprise AI' },
    ],
    days_ago: 30,
  },
  {
    companyName: null,
    tags: [],
    subject: 'LP meeting follow-up — portfolio allocation discussion',
    summary: 'Follow-up from LP advisory meeting covering Fund II deployment pace, reserve strategy, and initial Fund III timeline. LPs want to see more detail on Fund I realized returns at next meeting.',
    body_preview: 'Thanks for the productive discussion yesterday. Summarizing key takeaways: Fund II is 65% deployed with strong early signals...',
    days_ago: 45,
  },
  {
    companyName: 'GreenLeaf Bio',
    tags: [],
    subject: 'FDA pre-submission feedback',
    summary: 'Priya shared positive feedback from FDA pre-submission meeting. Regulatory pathway looks clearer than expected. Team targeting Q2 2026 for clearance filing.',
    body_preview: 'Great news from the FDA meeting. The reviewer was positive about our data package and confirmed that 510(k) is the right pathway...',
    days_ago: 20,
  },
  {
    companyName: 'AdVantage',
    tags: ['intro'],
    subject: 'Intro: Jamie Lin <> Sam Patel (Head of Growth, GrowthStack)',
    summary: 'Connected Jamie with Sam Patel at GrowthStack to discuss potential integration partnership and co-marketing for ad creative optimization in the SMB segment.',
    body_preview: 'Jamie, Sam — connecting you two as discussed at dinner last week. Sam\'s team is looking for creative optimization partners for GrowthStack\'s ad tools...',
    intro_contacts: [
      { name: 'Sam Patel', email: 'sam.patel@growthstack.example.com', context: 'Head of Growth at GrowthStack, exploring ad tech integration partners' },
    ],
    days_ago: 28,
  },
]

const EMAIL_REQUEST = {
  subject: 'Q4 2025 Portfolio Update Request',
  body_html: '<p>Hi team,</p><p>Please send your Q4 2025 metrics update at your earliest convenience. We are preparing our annual LP report and need current numbers for all portfolio companies.</p><p>Best,<br>Hemrock Demo Fund</p>',
  quarter_label: 'Q4 2025',
}

/** Seeds a complete demo fund. Returns true if data was newly seeded. */
export async function seedDemoData(adminUserId: string): Promise<boolean> {
  const admin = createAdminClient()

  // Check if demo data already exists
  const { data: existingFund } = await admin
    .from('funds')
    .select('id')
    .eq('name', DEMO_FUND_NAME)
    .maybeSingle()

  if (existingFund) {
    // Fund exists — clear and re-seed investment transactions
    await admin
      .from('investment_transactions')
      .delete()
      .eq('fund_id', existingFund.id)

    // Look up company IDs for this fund
    const { data: companies } = await admin
      .from('companies')
      .select('id, name')
      .eq('fund_id', existingFund.id)

    if (!companies) return false

    const companyIdMap: Record<string, string> = {}
    for (const c of companies) companyIdMap[c.name] = c.id

    for (const inv of INVESTMENTS) {
      const companyId = companyIdMap[inv.companyName]
      if (!companyId) continue

      await admin.from('investment_transactions').insert({
        company_id: companyId,
        fund_id: existingFund.id,
        transaction_type: inv.transaction_type,
        round_name: inv.round_name ?? null,
        transaction_date: inv.transaction_date,
        notes: inv.notes ?? null,
        investment_cost: inv.investment_cost ?? null,
        shares_acquired: inv.shares_acquired ?? null,
        share_price: inv.share_price ?? null,
        unrealized_value_change: inv.unrealized_value_change ?? null,
        current_share_price: inv.current_share_price ?? null,
        cost_basis_exited: inv.cost_basis_exited ?? null,
        proceeds_received: inv.proceeds_received ?? null,
        portfolio_group: inv.portfolio_group ?? null,
      })
    }

    // Fix feature_visibility — ensure all features visible to everyone
    await admin
      .from('fund_settings')
      .update({
        feature_visibility: {
          investments: 'everyone',
          funds: 'everyone',
          notes: 'everyone',
          lp_letters: 'everyone',
          imports: 'everyone',
          asks: 'everyone',
          interactions: 'everyone',
          compliance: 'everyone',
          deals: 'everyone',
          diligence: 'everyone',
          lps: 'everyone',
        },
        deal_intake_enabled: true,
        deal_thesis: DEMO_DEAL_THESIS,
      })
      .eq('fund_id', existingFund.id)

    // Backfill the new feature data so existing demo funds pick up Deals,
    // Diligence, and the LP snapshot. Each backfill is idempotent: clear
    // any prior demo rows first, then re-seed.
    await admin.from('inbound_deals').delete().eq('fund_id', existingFund.id)
    await admin.from('routing_corrections').delete().eq('fund_id', existingFund.id)
    await admin.from('known_referrers').delete().eq('fund_id', existingFund.id)
    // Wipe inbound_emails that are deal-pitches or audit-bucket only — keep
    // the existing reporting/interactions emails alone.
    await admin
      .from('inbound_emails')
      .delete()
      .eq('fund_id', existingFund.id)
      .in('routed_to', ['deals', 'audit'])

    await admin.from('diligence_attention_items').delete().eq('fund_id', existingFund.id)
    await admin.from('diligence_memo_drafts').delete().eq('fund_id', existingFund.id)
    await admin.from('diligence_documents').delete().eq('fund_id', existingFund.id)
    await admin.from('diligence_notes').delete().eq('fund_id', existingFund.id)
    await admin.from('diligence_agent_sessions').delete().eq('fund_id', existingFund.id)
    await admin.from('diligence_deals').delete().eq('fund_id', existingFund.id)

    await admin.from('lp_investments').delete().eq('fund_id', existingFund.id)
    await admin.from('lp_entities').delete().eq('fund_id', existingFund.id)
    await admin.from('lp_investors').delete().eq('fund_id', existingFund.id)
    await admin.from('lp_snapshots').delete().eq('fund_id', existingFund.id)

    await seedInboundDeals(admin, existingFund.id, adminUserId)
    await seedDiligence(admin, existingFund.id, adminUserId)
    await seedLpSnapshot(admin, existingFund.id)

    // Clear and re-seed interactions
    await admin
      .from('interactions')
      .delete()
      .eq('fund_id', existingFund.id)

    for (const intDef of INTERACTIONS) {
      const companyId = intDef.companyName ? companyIdMap[intDef.companyName] ?? null : null
      const interactionDate = new Date(Date.now() - intDef.days_ago * 86400000).toISOString()

      await admin.from('interactions').insert({
        fund_id: existingFund.id,
        company_id: companyId,
        user_id: adminUserId,
        tags: intDef.tags,
        subject: intDef.subject,
        summary: intDef.summary,
        body_preview: intDef.body_preview,
        intro_contacts: intDef.intro_contacts ?? [],
        interaction_date: interactionDate,
      })
    }

    console.log('[demo] Backfilled investment transactions, interactions, and fixed feature visibility')
    return true
  }

  // -------------------------------------------------------------------------
  // Find or create the demo user
  // -------------------------------------------------------------------------
  const demoEmail = process.env.DEMO_USER_EMAIL
  const demoPassword = process.env.DEMO_USER_PASSWORD
  if (!demoEmail || !demoPassword) {
    console.error('[demo] DEMO_USER_EMAIL and DEMO_USER_PASSWORD env vars are required')
    return false
  }

  // Check if the demo user already exists in auth
  const { data: existingUsers } = await admin.auth.admin.listUsers()
  const existingDemoUser = existingUsers?.users?.find(u => u.email === demoEmail)

  let demoUserId: string
  if (existingDemoUser) {
    demoUserId = existingDemoUser.id
  } else {
    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email: demoEmail,
      password: demoPassword,
      email_confirm: true,
    })
    if (createError || !newUser?.user) {
      console.error('[demo] Failed to create demo user:', createError)
      return false
    }
    demoUserId = newUser.user.id
  }

  // -------------------------------------------------------------------------
  // Create fund
  // -------------------------------------------------------------------------
  const { data: fund, error: fundError } = await admin
    .from('funds')
    .insert({ name: DEMO_FUND_NAME, created_by: adminUserId })
    .select('id')
    .single()

  if (fundError || !fund) {
    console.error('[demo] Failed to create fund:', fundError)
    return false
  }

  const fundId = fund.id

  // Remove the auto-created admin membership (from the fund_creator_member trigger)
  await admin.from('fund_members').delete()
    .eq('fund_id', fundId)
    .eq('user_id', adminUserId)

  // Add demo user as viewer
  await admin.from('fund_members').upsert({
    fund_id: fundId,
    user_id: demoUserId,
    role: 'viewer',
  }, { onConflict: 'fund_id,user_id' })

  // Create fund_settings — all features visible to everyone (including demo viewer)
  await admin.from('fund_settings').insert({
    fund_id: fundId,
    postmark_webhook_token: 'demo-token',
    feature_visibility: {
      investments: 'everyone',
      funds: 'everyone',
      notes: 'everyone',
      lp_letters: 'everyone',
      imports: 'everyone',
      asks: 'everyone',
      interactions: 'everyone',
      compliance: 'everyone',
      deals: 'everyone',
      diligence: 'everyone',
      lps: 'everyone',
    },
    deal_intake_enabled: true,
    deal_thesis: DEMO_DEAL_THESIS,
  })

  // -------------------------------------------------------------------------
  // Seed companies
  // -------------------------------------------------------------------------
  const companyIdMap: Record<string, string> = {}

  for (const companyData of COMPANIES) {
    const { data: company } = await admin
      .from('companies')
      .insert({
        fund_id: fundId,
        name: companyData.name,
        stage: companyData.stage,
        industry: companyData.industry,
        portfolio_group: [companyData.group],
        overview: companyData.overview,
        founders: companyData.founders,
        why_invested: companyData.why_invested,
        contact_email: companyData.contact_email,
        status: 'active',
      })
      .select('id')
      .single()

    if (!company) continue
    companyIdMap[companyData.name] = company.id

    // Metrics + values
    for (let i = 0; i < companyData.metrics.length; i++) {
      const mDef = companyData.metrics[i]
      const { data: metric } = await admin
        .from('metrics')
        .insert({
          company_id: company.id,
          fund_id: fundId,
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
          fund_id: fundId,
          period_label: v.label,
          period_year: v.year,
          period_quarter: v.quarter ?? null,
          period_month: v.month ?? null,
          value_number: v.val,
          confidence: 'high',
          is_manually_entered: false,
        })
      }
    }
  }

  // -------------------------------------------------------------------------
  // AI Summaries
  // -------------------------------------------------------------------------
  for (const [companyName, summaryText] of Object.entries(SUMMARIES)) {
    const companyId = companyIdMap[companyName]
    if (!companyId) continue

    await admin.from('company_summaries').insert({
      company_id: companyId,
      fund_id: fundId,
      summary_text: summaryText,
      period_label: 'Q4 2025',
    })
  }

  // -------------------------------------------------------------------------
  // Notes
  // -------------------------------------------------------------------------
  for (const noteDef of NOTES) {
    const companyId = noteDef.companyName ? companyIdMap[noteDef.companyName] ?? null : null
    await admin.from('company_notes').insert({
      fund_id: fundId,
      company_id: companyId,
      user_id: demoUserId,
      content: noteDef.content,
    } as any)
  }

  // -------------------------------------------------------------------------
  // Inbound Emails
  // -------------------------------------------------------------------------
  for (const emailDef of INBOUND_EMAILS) {
    const companyId = companyIdMap[emailDef.companyName] ?? null
    const receivedAt = new Date(Date.now() - emailDef.days_ago * 86400000).toISOString()

    await admin.from('inbound_emails').insert({
      fund_id: fundId,
      company_id: companyId,
      from_address: emailDef.from,
      subject: emailDef.subject,
      received_at: receivedAt,
      processing_status: 'success',
      metrics_extracted: emailDef.metrics_extracted,
      attachments_count: 0,
    })
  }

  // -------------------------------------------------------------------------
  // Parsing Reviews (unresolved)
  // -------------------------------------------------------------------------
  for (const reviewDef of REVIEW_ITEMS) {
    const companyId = companyIdMap[reviewDef.companyName]
    if (!companyId) continue

    // Look up the metric
    const { data: metric } = await admin
      .from('metrics')
      .select('id')
      .eq('company_id', companyId)
      .eq('slug', reviewDef.metricSlug)
      .maybeSingle()

    // Look up a related email (required field)
    const { data: email } = await admin
      .from('inbound_emails')
      .select('id')
      .eq('company_id', companyId)
      .limit(1)
      .maybeSingle()

    if (!email) continue

    await admin.from('parsing_reviews').insert({
      fund_id: fundId,
      company_id: companyId,
      metric_id: metric?.id ?? null,
      email_id: email.id,
      issue_type: reviewDef.issue_type,
      extracted_value: reviewDef.extracted_value,
      resolution: null,
    } as any)
  }

  // -------------------------------------------------------------------------
  // Documents (metadata only)
  // -------------------------------------------------------------------------
  for (const docDef of DOCUMENTS) {
    const companyId = companyIdMap[docDef.companyName]
    if (!companyId) continue

    await admin.from('company_documents' as any).insert({
      company_id: companyId,
      fund_id: fundId,
      filename: docDef.filename,
      file_type: docDef.file_type,
      file_size: docDef.file_size,
      storage_path: `demo/${docDef.filename}`,
      uploaded_by: demoUserId,
    })
  }

  // -------------------------------------------------------------------------
  // Email Request (sent)
  // -------------------------------------------------------------------------
  const recipients = Object.entries(companyIdMap).slice(0, 4).map(([name]) => {
    const company = COMPANIES.find(c => c.name === name)
    return {
      companyName: name,
      emails: company?.contact_email ?? [],
    }
  })

  await admin.from('email_requests').insert({
    fund_id: fundId,
    subject: EMAIL_REQUEST.subject,
    body_html: EMAIL_REQUEST.body_html,
    recipients,
    quarter_label: EMAIL_REQUEST.quarter_label,
    sent_by: demoUserId,
    status: 'sent',
    sent_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    send_results: { sent: recipients.length, failed: 0, details: [] },
  })

  // -------------------------------------------------------------------------
  // Investment Transactions
  // -------------------------------------------------------------------------
  for (const inv of INVESTMENTS) {
    const companyId = companyIdMap[inv.companyName]
    if (!companyId) continue

    await admin.from('investment_transactions').insert({
      company_id: companyId,
      fund_id: fundId,
      transaction_type: inv.transaction_type,
      round_name: inv.round_name ?? null,
      transaction_date: inv.transaction_date,
      notes: inv.notes ?? null,
      investment_cost: inv.investment_cost ?? null,
      shares_acquired: inv.shares_acquired ?? null,
      share_price: inv.share_price ?? null,
      unrealized_value_change: inv.unrealized_value_change ?? null,
      current_share_price: inv.current_share_price ?? null,
      cost_basis_exited: inv.cost_basis_exited ?? null,
      proceeds_received: inv.proceeds_received ?? null,
    })
  }

  // -------------------------------------------------------------------------
  // Fund Cash Flows
  // -------------------------------------------------------------------------
  for (const cf of FUND_CASH_FLOWS) {
    await admin.from('fund_cash_flows' as any).insert({
      fund_id: fundId,
      portfolio_group: cf.portfolio_group,
      flow_date: cf.flow_date,
      flow_type: cf.flow_type,
      amount: cf.amount,
      notes: cf.notes ?? null,
    })
  }

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------
  for (const intDef of INTERACTIONS) {
    const companyId = intDef.companyName ? companyIdMap[intDef.companyName] ?? null : null
    const interactionDate = new Date(Date.now() - intDef.days_ago * 86400000).toISOString()

    await admin.from('interactions').insert({
      fund_id: fundId,
      company_id: companyId,
      user_id: demoUserId,
      tags: intDef.tags,
      subject: intDef.subject,
      summary: intDef.summary,
      body_preview: intDef.body_preview,
      intro_contacts: intDef.intro_contacts ?? [],
      interaction_date: interactionDate,
    })
  }

  // -------------------------------------------------------------------------
  // LP Letter Template + Letter
  // -------------------------------------------------------------------------
  const { data: template } = await admin.from('lp_letter_templates').insert({
    fund_id: fundId,
    name: 'Default',
    is_default: true,
    source_type: 'default',
    style_guide: 'Professional, concise quarterly update format. Lead with key metrics and highlights, then address challenges and outlook. Use data-driven language and avoid jargon.',
  }).select('id').single()

  if (template) {
    // Fund I Q4 2025 letter
    const fundICompanies = ['NovaTech', 'GreenLeaf Bio', 'RouteWise', 'AdVantage']
    const fundINarratives = [
      { name: 'NovaTech', narrative: 'NovaTech closed Q4 2025 with MRR reaching $225K, up 18% quarter-over-quarter and 88% year-over-year. Net revenue retention remains strong at 125%, driven by the launch of their AI-powered churn prediction module in October. The team expanded to 42 FTEs with key hires in enterprise sales. Cash position stands at $3.2M with a 14-month runway. The company is in early conversations for a Series A+ round at a $45M pre-money valuation. Key risk: concentration in mid-market SaaS segment.' },
      { name: 'GreenLeaf Bio', narrative: 'GreenLeaf Bio made significant progress on their EPA regulatory submission, which is now on track for Q2 2026 approval. The team secured a $500K non-dilutive grant from the National Science Foundation. Revenue remains pre-commercial at $15K/month from pilot partnerships. Headcount grew to 12 with two PhD-level scientists joining the R&D team. Cash position of $580K provides approximately 8 months of runway. The company is exploring a bridge round to extend runway through EPA approval.' },
      { name: 'RouteWise', narrative: 'RouteWise delivered another strong quarter with ARR crossing $8.5M, up 22% QoQ. The logistics optimization platform processed 2.1M routes in Q4, a 3x increase from Q4 2024. Gross margins improved to 78% as infrastructure costs scaled sub-linearly. The Series B funding ($15M at $85M pre) closed in November, extending runway to 24+ months. The team is expanding into European markets with a London office opening in Q1 2026. Notable new clients include two Fortune 500 retailers.' },
      { name: 'AdVantage', narrative: 'AdVantage grew revenue to $180K MRR in Q4, up 12% from Q3. The ad-tech platform now serves 340 enterprise customers across retail and e-commerce verticals. Customer acquisition cost decreased 25% following the launch of self-serve onboarding. The team of 28 is focused on building programmatic TV capabilities for 2026. Cash position of $2.8M with 16 months runway. Exploring strategic partnerships with two major DSPs for distribution.' },
    ]

    const narratives = fundICompanies.map((name, i) => ({
      company_id: companyIdMap[name] ?? '',
      company_name: name,
      narrative: fundINarratives[i]?.narrative ?? '',
      updated_by: null,
      updated_at: new Date().toISOString(),
    })).filter(n => n.company_id)

    const portfolioSummary = [
      { company_id: companyIdMap['NovaTech'] ?? '', company_name: 'NovaTech', status: 'active', stage: 'Series A', total_invested: 2000000, fmv: 4500000, moic: 2.25 },
      { company_id: companyIdMap['GreenLeaf Bio'] ?? '', company_name: 'GreenLeaf Bio', status: 'active', stage: 'Seed', total_invested: 750000, fmv: 1000000, moic: 1.33 },
      { company_id: companyIdMap['RouteWise'] ?? '', company_name: 'RouteWise', status: 'active', stage: 'Series B', total_invested: 3400000, fmv: 12737500, moic: 3.75 },
      { company_id: companyIdMap['AdVantage'] ?? '', company_name: 'AdVantage', status: 'active', stage: 'Series A', total_invested: 2000000, fmv: 3200000, moic: 1.6 },
    ].filter(p => p.company_id)

    await admin.from('lp_letters').insert({
      fund_id: fundId,
      template_id: template.id,
      period_year: 2025,
      period_quarter: 4,
      is_year_end: true,
      period_label: 'Q4 2025 / Year End 2025',
      portfolio_group: 'Fund I',
      company_narratives: narratives,
      portfolio_summary: portfolioSummary,
      full_draft: `# Hemrock Ventures — Fund I\n## Q4 2025 / Year End 2025 Portfolio Update\n\nDear Limited Partners,\n\nWe are pleased to share our Q4 2025 portfolio update for Fund I. The portfolio continues to perform well, with aggregate gross MOIC of 2.63x across four active companies. Total invested capital stands at $8.15M with a current portfolio FMV of $21.4M.\n\n### Portfolio Highlights\n\n- **RouteWise** remains our standout performer at 3.75x MOIC following a strong Series B close\n- **NovaTech** crossed $225K MRR with 88% YoY growth\n- **AdVantage** reduced CAC by 25% through self-serve onboarding\n- **GreenLeaf Bio** secured NSF grant and is on track for EPA approval in Q2 2026\n\n---\n\n${fundINarratives.map(n => `### ${n.name}\n\n${n.narrative}`).join('\n\n---\n\n')}\n\n---\n\nWe appreciate your continued partnership and look forward to discussing these results in our upcoming annual meeting.\n\nBest regards,\nHemrock Ventures`,
      status: 'draft',
      created_by: demoUserId,
    })
  }

  // -------------------------------------------------------------------------
  // Compliance — profile + settings for demo fund
  // -------------------------------------------------------------------------
  await admin.from('fund_compliance_profile' as any).upsert({
    fund_id: fundId,
    registration_status: 'era',
    aum_range: '25m_100m',
    fund_structure: 'lp',
    fundraising_status: 'closed_recent',
    reg_d_exemption: '506b',
    investor_state_count: '6_to_15',
    california_nexus: ['investments_ca'],
    public_equity: 'no',
    cftc_activity: 'yes_with_exemption',
    access_person_count: '1_to_3',
    has_foreign_entities: 'no',
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    updated_by: demoUserId,
  }, { onConflict: 'fund_id' })

  // Mark some items as applicable (active, not dismissed) so they show on the calendar
  const activeItems = [
    { compliance_item_id: 'cftc-exemption', applies: 'yes' },
    { compliance_item_id: 'form-adv', applies: 'yes' },
    { compliance_item_id: 'tax-7004', applies: 'yes' },
  ]
  for (const item of activeItems) {
    await admin.from('compliance_fund_settings' as any).upsert({
      fund_id: fundId,
      compliance_item_id: item.compliance_item_id,
      portfolio_group: '',
      applies: item.applies,
      dismissed: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'fund_id,compliance_item_id,portfolio_group' })
  }

  // Set some items as not applicable
  const naItems = [
    'form-13f', 'sched-13g', 'form-13h', 'form-npx', 'boi-report',
  ]
  for (const itemId of naItems) {
    await admin.from('compliance_fund_settings' as any).upsert({
      fund_id: fundId,
      compliance_item_id: itemId,
      portfolio_group: '',
      applies: 'no',
      dismissed: true,
      dismissed_by: demoUserId,
      dismissed_at: new Date().toISOString(),
      dismissed_reason: 'Not applicable based on fund profile',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'fund_id,compliance_item_id,portfolio_group' })
  }

  // Add a couple of demo compliance links
  await (admin.from('compliance_links' as any) as any).insert([
    {
      fund_id: fundId,
      compliance_item_id: 'form-adv',
      title: 'IARD Filing Account',
      description: 'FINRA CRD/IARD portal for Form ADV filings',
      url: 'https://crd.finra.org/Iad/',
      created_by: demoUserId,
    },
    {
      fund_id: fundId,
      compliance_item_id: 'blue-sky',
      title: 'NASAA EFD Portal',
      description: 'Electronic filing depository for state notice filings',
      url: 'https://nasaaefd.org/',
      created_by: demoUserId,
    },
    {
      fund_id: fundId,
      compliance_item_id: 'tax-1065',
      title: 'IRS e-File',
      description: 'Partnership return e-filing system',
      url: 'https://www.irs.gov/e-file-providers/e-file-for-large-and-mid-size-corporations',
      created_by: demoUserId,
    },
  ])

  // -------------------------------------------------------------------------
  // Inbound Deals (pitches + classifier output)
  // -------------------------------------------------------------------------
  await seedInboundDeals(admin, fundId, demoUserId)

  // -------------------------------------------------------------------------
  // Diligence (deals + documents + memo drafts + attention items)
  // -------------------------------------------------------------------------
  await seedDiligence(admin, fundId, demoUserId)

  // -------------------------------------------------------------------------
  // LP snapshot (Year End 2025)
  // -------------------------------------------------------------------------
  await seedLpSnapshot(admin, fundId)

  console.log('[demo] Demo data seeded successfully')
  return true
}
