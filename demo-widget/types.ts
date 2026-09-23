/**
 * The demo widget's data contract.
 *
 * `snapshot.json` is an export of the demo fund (scripts/demo-snapshot.ts) and `answers.json`
 * the Analyst's stored replies to a fixed set of questions (scripts/demo-answers.ts). The mock
 * API in mock-api.ts answers the app's own routes from these two files, so the components in
 * components/ never know they are not talking to the product. When a component starts needing
 * a field the snapshot lacks, add it here and to the exporter; the site's build checks
 * `schemaVersion` against what the widget was built for.
 */
export const DEMO_SCHEMA_VERSION = 2

export interface DemoMetricValue {
  period_label: string
  year: number
  quarter: number | null
  month: number | null
  number: number | null
}

export interface DemoMetric {
  id: string
  company_id: string
  name: string
  slug: string
  unit: string | null
  unit_position: 'prefix' | 'suffix' | string
  value_type: 'currency' | 'percentage' | 'number' | string
  cadence: string
  display_order: number
  values: DemoMetricValue[]
}

export interface DemoCompany {
  id: string
  name: string
  aliases: string[] | null
  industry: string[] | null
  stage: string | null
  status: string
  overview: string | null
  founders: string | null
  why_invested: string | null
  portfolio_group: string[] | null
  metrics: DemoMetric[]
}

export interface DemoDeal {
  id: string
  company_name: string | null
  founder_name: string | null
  status: string
  stage: string | null
  industry: string | null
  raise_amount: string | null
  intro_source: string | null
  thesis_fit_score: string | null
  company_summary: string | null
  thesis_fit_analysis: string | null
}

export interface DemoNote { id: string; company_id: string | null; content: string; created_at: string }
export interface DemoInteraction { company_id: string | null; subject: string; summary: string; date: string }
export interface DemoInvestment {
  company_id: string
  vehicle: string
  type: 'investment' | 'unrealized_gain_change' | string
  date: string
  round?: string
  cost?: number
  share_price?: number
  unrealized_change?: number
  mark_share_price?: number
  note?: string
}

export interface DemoSnapshot {
  schemaVersion: number
  generatedAt: string
  source: string
  fund: { name: string; currency: string }
  vehicles: { id: string; name: string; kind: string | null }[]
  companies: DemoCompany[]
  lps: { id: string; name: string }[]
  deals: DemoDeal[]
  notes: DemoNote[]
  interactions: DemoInteraction[]
  investments: DemoInvestment[]
}

/** `portfolio`, or `company:<id>`; the same scope key the Analyst uses. */
export type DemoScope = 'portfolio' | `company:${string}`

export interface DemoAnswer {
  scope: DemoScope
  question: string
  /** Other phrasings that should land on this reply. */
  aliases?: string[]
  reply: string
  /** Set by scripts/demo-answers.ts when the reply came from the real Analyst. */
  model?: { id: string; provider: string }
}

export interface DemoAnswers {
  schemaVersion: number
  generatedBy: 'authored' | 'analyst'
  note?: string
  fallback: string
  suggestions: { portfolio: string[]; company: Record<string, string[]> }
  answers: DemoAnswer[]
}

/**
 * What the server pages loaded, keyed by the URL they serve: the output of every loader in
 * lib/pages/registry.ts, run as the demo fund's viewer by scripts/demo-snapshot.ts. The widget
 * mounts each page's view with the entry for its URL.
 */
export interface DemoPages {
  schemaVersion: number
  generatedAt: string
  pages: Record<string, unknown>
}

/**
 * The app's API as the demo fund's viewer saw it: every JSON response the widget's pages
 * requested while scripts/demo-record.mjs walked them, keyed by method, path and sorted query.
 * The mock fetch answers from here first, then from the structured snapshot, then 404.
 */
export interface DemoApi {
  schemaVersion: number
  recordedAt: string
  responses: Record<string, { status: number; body: unknown }>
}

/** Everything the widget mounts with. */
export interface DemoData {
  snapshot: DemoSnapshot
  answers: DemoAnswers
  pages: DemoPages
  api: DemoApi
}

export const EMPTY_PAGES: DemoPages = { schemaVersion: DEMO_SCHEMA_VERSION, generatedAt: '', pages: {} }
export const EMPTY_API: DemoApi = { schemaVersion: DEMO_SCHEMA_VERSION, recordedAt: '', responses: {} }
