import { createAdminClient } from '@/lib/supabase/admin'

const DEMO_FUND_NAME = 'Hemrock Demo'

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
    name: 'UrbanFlow',
    stage: 'Series B',
    industry: ['Logistics', 'SaaS'],
    group: 'Fund I',
    overview: 'Last-mile delivery optimization platform used by enterprise retailers and logistics providers.',
    founders: 'James Okafor, Lin Wei',
    why_invested: 'Category leader in a $40B TAM with sticky enterprise contracts and strong unit economics.',
    contact_email: ['james@urbanflow.co', 'lin@urbanflow.co'],
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
    name: 'Marpipe',
    stage: 'Series A',
    industry: ['AdTech'],
    group: 'Fund I',
    overview: 'Multivariate creative testing platform that automates ad creative optimization at scale.',
    founders: 'Dan Pantelo, Conor Malloy',
    why_invested: 'Unique creative-first approach to ad optimization with rapid adoption among performance marketers.',
    contact_email: ['dan@marpipe.com'],
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
    name: 'Clearpath',
    stage: 'Seed',
    industry: ['Climate Tech'],
    group: 'Fund II',
    overview: 'Carbon accounting and offset management platform for mid-market enterprises.',
    founders: 'Anna Kowalski, Raj Mehta',
    why_invested: 'Regulatory tailwinds (CSRD, SEC climate rules) create strong demand pull for compliance tooling.',
    contact_email: ['anna@clearpath.earth'],
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
    name: 'PayStack',
    stage: 'Series A',
    industry: ['Fintech'],
    group: 'Fund II',
    overview: 'Embedded payments infrastructure for African merchants, processing card, mobile money, and bank transfers.',
    founders: 'Adebayo Ojo',
    why_invested: 'First-mover in a rapidly digitizing payments market with 50M+ potential merchants.',
    contact_email: ['adebayo@paystack.ng'],
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
    name: 'Marqo',
    stage: 'Pre-Seed',
    industry: ['AI / ML'],
    group: 'Fund II',
    overview: 'Open-source tensor search engine for multimodal AI applications (text, image, video).',
    founders: 'Jesse Clark',
    why_invested: 'Strong open-source traction and early enterprise adoption for AI search infrastructure.',
    contact_email: ['jesse@marqo.ai'],
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

  UrbanFlow: `UrbanFlow closed Q1 2026 with $6.1M ARR, up 45% year-over-year. The company continues to add enterprise customers at a healthy pace (74 as of Q1 2026), and gross margins have expanded to 68%. The business is approaching cash flow breakeven as unit economics improve.

The expansion from logistics into retail fulfillment is showing early traction, with 8 new retail customers signed in Q4. This vertical diversification reduces concentration risk. Recommend discussing Series C timeline at the next board meeting.`,

  Benchline: `Benchline crossed the $10M ARR milestone in Q4 2025, driven by strong net dollar retention of 127%. The company added 10 new enterprise customers in Q4 and is seeing accelerating inbound interest from PE-backed SaaS companies looking for operational benchmarks.

Headcount grew to 62, primarily in engineering and customer success. Cash position remains strong at $14M, providing 18+ months of runway. The network effect thesis is playing out as planned — each new customer makes the dataset more valuable for all participants.`,

  PayStack: `PayStack processed $19.5M in GMV in December 2025, a seasonal high driven by holiday spending. Revenue scaled proportionally to $292K. The 1.5% take rate remains stable and in line with regional benchmarks.

Cash position of $3.2M at year-end provides roughly 12 months of runway at current burn. The team should begin Series B discussions in Q2 2026. Key risk: currency volatility in core markets continues to create FX headwinds on USD-reported metrics.`,
}

const NOTES = [
  { companyName: null, content: 'Q4 portfolio review scheduled for March 15. Need updated financials from all companies by March 1.' },
  { companyName: 'NovaTech', content: 'Sarah mentioned they are exploring a strategic partnership with Salesforce. Follow up in next 1:1.' },
  { companyName: 'UrbanFlow', content: 'Board meeting recap: team presented Series C readiness plan. Targeting Q3 2026 raise at $50M+ valuation.' },
  { companyName: 'GreenLeaf Bio', content: 'FDA pre-submission meeting went well. Team expects to file for regulatory clearance in Q2 2026.' },
  { companyName: null, content: 'LP update call next Thursday. Prepare portfolio summary with highlights from Benchline and UrbanFlow.' },
  { companyName: 'Marqo', content: 'GitHub stars passed 5K. Jesse is presenting at NeurIPS next month — great visibility for enterprise pipeline.' },
]

const INBOUND_EMAILS = [
  { from: 'sarah@novatech.io', subject: 'NovaTech December 2025 Update', companyName: 'NovaTech', metrics_extracted: 4, days_ago: 12 },
  { from: 'james@urbanflow.co', subject: 'UrbanFlow Q1 2026 Quarterly Report', companyName: 'UrbanFlow', metrics_extracted: 3, days_ago: 5 },
  { from: 'emily@benchline.com', subject: 'Benchline Q4 2025 Board Deck', companyName: 'Benchline', metrics_extracted: 4, days_ago: 20 },
  { from: 'adebayo@paystack.ng', subject: 'PayStack January 2026 Metrics', companyName: 'PayStack', metrics_extracted: 3, days_ago: 8 },
]

const REVIEW_ITEMS = [
  { issue_type: 'low_confidence', extracted_value: '340000', companyName: 'Marpipe', metricSlug: 'mrr' },
  { issue_type: 'duplicate_period', extracted_value: '5500000', companyName: 'UrbanFlow', metricSlug: 'arr' },
  { issue_type: 'ambiguous_period', extracted_value: '292000', companyName: 'PayStack', metricSlug: 'revenue' },
]

const DOCUMENTS = [
  { companyName: 'NovaTech', filename: 'NovaTech_Board_Deck_Q4_2025.pdf', file_type: 'application/pdf', file_size: 2400000 },
  { companyName: 'UrbanFlow', filename: 'UrbanFlow_Financial_Model_2026.xlsx', file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', file_size: 890000 },
  { companyName: 'Benchline', filename: 'Benchline_Series_B_Memo.pdf', file_type: 'application/pdf', file_size: 1500000 },
  { companyName: 'Clearpath', filename: 'Clearpath_IP_Overview.pdf', file_type: 'application/pdf', file_size: 650000 },
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

  if (existingFund) return false

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

  // Add demo user as viewer
  await admin.from('fund_members').upsert({
    fund_id: fundId,
    user_id: demoUserId,
    role: 'viewer',
  }, { onConflict: 'fund_id,user_id' })

  // Create fund_settings
  await admin.from('fund_settings').insert({
    fund_id: fundId,
    postmark_webhook_token: 'demo-token',
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

  console.log('[demo] Demo data seeded successfully')
  return true
}
