// Pure metadata for the platform MCP tools — name, description, scope, and the
// JSON-Schema input contract. NO server imports, so this is safe to pull into
// client components (the Settings "Agent access" panel lists these). Handlers
// live in tools.ts, which merges these with server-side implementations.
//
// v1 surface is READ-ONLY. Every tool here is `scope: 'read'`. Write capability
// currently comes only from the ledger tool set (folded in at the endpoint) and
// is gated behind the admin `mcp_write_enabled` opt-in. New platform write tools,
// when added, slot in here with `scope: 'write'` under that same switch.

export interface McpToolMeta {
  name: string
  description: string
  scope: 'read' | 'write'
  /** When true, only an admin's key may see or call this tool (sensitive data). */
  admin?: boolean
  /**
   * For write tools: which admin-controlled capability this belongs to. A write
   * tool runs only when its category is enabled in fund_settings.mcp_write_scopes.
   * Ledger write tools (folded in from the accounting registry) use 'ledger'.
   */
  writeCategory?: string
  inputSchema: Record<string, any>
}

/**
 * The writable capabilities an admin can toggle in Settings. Each maps to the
 * `writeCategory` on one or more tools. `ledger` is shown only when the fund has
 * accounting enabled. Keep labels short — they render as toggle rows.
 */
export interface McpWriteCategory {
  key: string
  label: string
  description: string
  /** Only relevant when the fund's accounting feature is on. */
  accountingOnly?: boolean
}

export const MCP_WRITE_CATEGORIES: McpWriteCategory[] = [
  { key: 'companies', label: 'Add companies', description: 'Create portfolio companies.' },
  { key: 'metrics', label: 'Record KPI values', description: 'Write KPI metric values for a company.' },
  { key: 'notes', label: 'Add notes', description: 'Create internal notes.' },
  { key: 'interactions', label: 'Log interactions', description: 'Record interactions (meetings, intros, value-adds).' },
  {
    key: 'ledger',
    label: 'Ledger writes',
    description: 'Post journal entries, run allocations, import bank data, close periods.',
    accountingOnly: true,
  },
]

const EMPTY: Record<string, any> = { type: 'object', properties: {}, additionalProperties: false }

export const PLATFORM_TOOL_MANIFEST: McpToolMeta[] = [
  {
    name: 'get_fund_context',
    description:
      "Orient the agent: the fund's name, reporting currency, portfolio-company count, which feature sets are on (accounting, deals, LPs), and the calling key's role. Call this first.",
    scope: 'read',
    inputSchema: EMPTY,
  },
  {
    name: 'list_companies',
    description:
      'List portfolio companies with stage, status, industry, tags, portfolio group, KPI-metric count, and the date of their most recent investor update.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'exited', 'written-off'], description: 'Filter by company status.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_company',
    description:
      'Full profile for one company: overview/founders/why-invested, its latest KPI metric values, and its investment summary (invested, realized, fair value, MOIC, gross IRR). Identify the company by id or exact name.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        companyId: { type: 'string', description: 'Company UUID (preferred).' },
        name: { type: 'string', description: 'Exact company name, if the id is unknown.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_metric_history',
    description:
      "A single KPI's full time series for a company (one point per reporting period, latest extraction per period). Identify the metric by id or slug (e.g. 'mrr', 'headcount').",
    scope: 'read',
    inputSchema: {
      type: 'object',
      required: ['companyId'],
      properties: {
        companyId: { type: 'string', description: 'Company UUID.' },
        metricId: { type: 'string', description: 'Metric UUID (preferred).' },
        metricSlug: { type: 'string', description: 'Metric slug, if the id is unknown.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'portfolio_performance',
    description:
      'Fund-level performance: total invested, realized, unrealized, and fair market value, portfolio MOIC, and a gross fund IRR, plus a per-company breakdown (each with its authoritative MOIC and gross IRR). Optional as-of date for point-in-time figures.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        asOf: { type: 'string', description: 'ISO date YYYY-MM-DD; defaults to today.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_deals',
    description:
      'The inbound deal pipeline: company, founder, intro source, thesis-fit score, stage, raise amount, and status. Optional filters by status and fit score.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Comma-separated statuses, e.g. "new,reviewing".' },
        fitScore: { type: 'string', enum: ['strong', 'moderate', 'weak', 'out_of_thesis', 'spam'] },
        limit: { type: 'number', description: 'Max rows (default 100, max 500).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_lps',
    description:
      'List the fund\'s limited partners (top-level investors and their legal entities). Admin key required — this is investor-directory data.',
    scope: 'read',
    admin: true,
    inputSchema: EMPTY,
  },
  {
    name: 'lp_commitments',
    description:
      'Per-LP capital-account figures from the latest snapshot (or a given snapshot): commitment, paid-in, called, distributions, NAV, TVPI, DPI, IRR, by vehicle. Admin key required.',
    scope: 'read',
    admin: true,
    inputSchema: {
      type: 'object',
      properties: {
        snapshotId: { type: 'string', description: 'A specific lp_snapshots id; omit for the latest.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_notes',
    description:
      'Recent internal notes (most-recent first, pinned first). Optionally scope to one company.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        companyId: { type: 'string', description: 'Limit to notes on this company.' },
        limit: { type: 'number', description: 'Max rows (default 100, max 200).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_interactions',
    description:
      'Recent logged interactions (meetings, intros, value-adds) with subject, summary, tags, and date. Optional filters by company and tag.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        companyId: { type: 'string', description: 'Limit to interactions on this company.' },
        tag: { type: 'string', description: 'Limit to interactions carrying this tag.' },
        limit: { type: 'number', description: 'Max rows (default 50, max 200).' },
      },
      additionalProperties: false,
    },
  },

  // ---- Write tools (v1) --------------------------------------------------
  // Each is gated by its writeCategory in fund_settings.mcp_write_scopes, plus an
  // admin owner and a write-scoped key. All are off until an admin opts in.
  {
    name: 'add_company',
    description: 'Create a portfolio company. Returns the new company id.',
    scope: 'write',
    writeCategory: 'companies',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        stage: { type: 'string' },
        industry: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        overview: { type: 'string' },
        founders: { type: 'string' },
        whyInvested: { type: 'string' },
        contactEmail: { type: 'array', items: { type: 'string' } },
        portfolioGroup: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'record_metric_value',
    description:
      'Record a KPI value for a company metric in a reporting period. Identify the metric by id or slug; the value is numeric or text depending on the metric. Marked as manually entered.',
    scope: 'write',
    writeCategory: 'metrics',
    inputSchema: {
      type: 'object',
      required: ['companyId', 'periodYear'],
      properties: {
        companyId: { type: 'string' },
        metricId: { type: 'string', description: 'Metric UUID (preferred).' },
        metricSlug: { type: 'string', description: 'Metric slug, if the id is unknown.' },
        periodYear: { type: 'number' },
        periodQuarter: { type: 'number', description: '1–4, for quarterly metrics.' },
        periodMonth: { type: 'number', description: '1–12, for monthly metrics.' },
        periodLabel: { type: 'string', description: 'e.g. "Q2 2026"; derived if omitted.' },
        valueNumber: { type: 'number' },
        valueText: { type: 'string' },
        notes: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_note',
    description: 'Add an internal note, optionally attached to a company.',
    scope: 'write',
    writeCategory: 'notes',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string' },
        companyId: { type: 'string', description: 'Attach the note to this company; omit for a general note.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_interaction',
    description: 'Log an interaction (meeting, intro, value-add), optionally attached to a company.',
    scope: 'write',
    writeCategory: 'interactions',
    inputSchema: {
      type: 'object',
      required: ['summary'],
      properties: {
        summary: { type: 'string' },
        subject: { type: 'string' },
        companyId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        interactionDate: { type: 'string', description: 'ISO date; defaults to today.' },
      },
      additionalProperties: false,
    },
  },
]
