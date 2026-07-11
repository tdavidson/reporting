// Platform MCP tool registry — merges the pure manifest (name/description/scope/
// schema) with server-side handlers, and folds in the ledger tool set (from the
// accounting registry) as one unified surface. Both /api/mcp and its REST twin
// dispatch through this list, so an agent sees the same tools however it connects.
//
// Context passed to every handler is the resolved key's fund + owner. Fund
// scoping is applied in code (.eq('fund_id', ...)) exactly as the app's own read
// routes do — RLS is a backstop, not the sole boundary.

import type { SupabaseClient } from '@supabase/supabase-js'
import { PLATFORM_TOOL_MANIFEST, type McpToolMeta } from './tools-manifest'
import type { McpConfig } from './auth'
import { computeSummary } from '@/lib/investments'
import { xirr, type CashFlow } from '@/lib/xirr'
import { AGENT_TOOLS, resolveVehicle } from '@/lib/accounting/agent-tools'
import { logActivity } from '@/lib/activity'
import type { CompanyStatus } from '@/lib/types/database'

export interface McpToolContext {
  admin: SupabaseClient
  fundId: string
  userId: string
  /** The key owner's CURRENT fund role. */
  role: string
}

export type McpToolHandler = (ctx: McpToolContext, input: any) => Promise<any>

export interface McpTool extends McpToolMeta {
  section: 'platform' | 'ledger'
  handler: McpToolHandler
}

// Postgres `numeric` can arrive as a string over supabase-js; coerce defensively.
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return typeof n === 'number' && isFinite(n) ? n : 0
}
const clamp = (v: unknown, def: number, max: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def
}

async function resolveCompany(
  admin: SupabaseClient,
  fundId: string,
  input: { companyId?: string; name?: string }
) {
  let q = admin.from('companies').select('*').eq('fund_id', fundId)
  if (input.companyId) q = q.eq('id', input.companyId)
  else if (input.name) q = q.eq('name', input.name)
  else throw new Error('Provide companyId or name')
  const { data } = await q.maybeSingle()
  if (!data) throw new Error('Company not found')
  return data as { id: string; name: string; status: string | null; [k: string]: unknown }
}

// ---- read handlers ------------------------------------------------------

const HANDLERS: Record<string, McpToolHandler> = {
  get_fund_context: async ({ admin, fundId, role }) => {
    const [{ data: fund }, { data: settings }, { count }] = await Promise.all([
      admin.from('funds').select('name').eq('id', fundId).maybeSingle(),
      admin.from('fund_settings').select('currency, feature_visibility').eq('fund_id', fundId).maybeSingle(),
      admin.from('companies').select('id', { count: 'exact', head: true }).eq('fund_id', fundId),
    ])
    const fv = ((settings as any)?.feature_visibility ?? {}) as Record<string, string>
    return {
      fundName: (fund as any)?.name ?? null,
      currency: (settings as any)?.currency ?? 'USD',
      yourRole: role,
      companyCount: count ?? 0,
      features: {
        accounting: fv.accounting !== 'off',
        deals: fv.deals !== 'off',
        lps: fv.lps !== 'off',
      },
    }
  },

  list_companies: async ({ admin, fundId }, input) => {
    let q = admin
      .from('companies')
      .select('id, name, stage, status, industry, tags, portfolio_group, metrics(id), inbound_emails(received_at)')
      .eq('fund_id', fundId)
    if (input?.status) q = q.eq('status', input.status)
    const { data } = await q.order('name')
    return (data ?? []).map((c: any) => {
      const emails = c.inbound_emails ?? []
      const lastReportAt = emails.length
        ? emails.reduce((max: string, e: any) => (e.received_at > max ? e.received_at : max), emails[0].received_at)
        : null
      return {
        id: c.id,
        name: c.name,
        stage: c.stage,
        status: c.status,
        industry: c.industry,
        tags: c.tags ?? [],
        portfolioGroup: c.portfolio_group,
        metricsCount: c.metrics?.length ?? 0,
        lastReportAt,
      }
    })
  },

  get_company: async ({ admin, fundId }, input) => {
    const company = await resolveCompany(admin, fundId, input)
    const [{ data: metrics }, { data: txns }] = await Promise.all([
      admin
        .from('metrics')
        .select('id, name, slug, unit, value_type, reporting_cadence, metric_values(value_number, value_text, period_label, created_at)')
        .eq('company_id', company.id)
        .eq('fund_id', fundId)
        .order('display_order'),
      admin.from('investment_transactions' as any).select('*').eq('company_id', company.id).eq('fund_id', fundId),
    ])
    const latestMetrics = (metrics ?? []).map((m: any) => {
      const vals = [...(m.metric_values ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      const l = vals[0]
      return {
        id: m.id,
        name: m.name,
        slug: m.slug,
        unit: m.unit,
        valueType: m.value_type,
        latest: l ? { valueNumber: l.value_number, valueText: l.value_text, period: l.period_label } : null,
      }
    })
    const summary = computeSummary((txns ?? []) as any[], (company.status ?? 'active') as CompanyStatus)
    return {
      id: company.id,
      name: company.name,
      stage: company.stage ?? null,
      status: company.status,
      industry: company.industry ?? null,
      overview: company.overview ?? null,
      founders: company.founders ?? null,
      whyInvested: company.why_invested ?? null,
      currentUpdate: company.current_update ?? null,
      metrics: latestMetrics,
      investment: {
        totalInvested: summary.totalInvested,
        totalRealized: summary.totalRealized,
        fairMarketValue: summary.fmv,
        moic: summary.moic,
        grossIrr: summary.grossIrr,
      },
    }
  },

  get_metric_history: async ({ admin, fundId }, input) => {
    if (!input?.companyId) throw new Error('companyId is required')
    let metricId = input.metricId as string | undefined
    if (!metricId) {
      if (!input.metricSlug) throw new Error('Provide metricId or metricSlug')
      const { data: m } = await admin
        .from('metrics')
        .select('id')
        .eq('company_id', input.companyId)
        .eq('fund_id', fundId)
        .eq('slug', input.metricSlug)
        .maybeSingle()
      if (!m) throw new Error(`No metric with slug "${input.metricSlug}" for this company`)
      metricId = (m as any).id
    }
    const { data } = await admin
      .from('metric_values')
      .select('value_number, value_text, period_label, period_year, period_quarter, period_month, created_at')
      .eq('metric_id', metricId)
      .eq('company_id', input.companyId)
      .eq('fund_id', fundId)
      .order('period_year')
      .order('period_quarter', { nullsFirst: false })
      .order('period_month', { nullsFirst: false })
    // Keep the latest extraction per period.
    const byPeriod = new Map<string, any>()
    for (const v of (data ?? []) as any[]) {
      const key = `${v.period_year}-${v.period_quarter ?? ''}-${v.period_month ?? ''}`
      const prev = byPeriod.get(key)
      if (!prev || v.created_at > prev.created_at) byPeriod.set(key, v)
    }
    return Array.from(byPeriod.values()).map((v) => ({
      period: v.period_label,
      valueNumber: v.value_number,
      valueText: v.value_text,
    }))
  },

  portfolio_performance: async ({ admin, fundId }, input) => {
    const asOf = input?.asOf ? new Date(input.asOf) : new Date()
    const [{ data: txns }, { data: companies }] = await Promise.all([
      admin.from('investment_transactions' as any).select('*').eq('fund_id', fundId),
      admin.from('companies').select('id, name, status, portfolio_group').eq('fund_id', fundId),
    ])
    const byCompany = new Map<string, any[]>()
    for (const t of (txns ?? []) as any[]) {
      const arr = byCompany.get(t.company_id) ?? []
      arr.push(t)
      byCompany.set(t.company_id, arr)
    }
    let totalInvested = 0, totalRealized = 0, totalUnrealized = 0, totalFMV = 0
    const rows: any[] = []
    const flows: CashFlow[] = []
    for (const c of (companies ?? []) as any[]) {
      const cTxns = byCompany.get(c.id) ?? []
      if (!cTxns.length) continue
      const s = computeSummary(cTxns, (c.status ?? 'active') as CompanyStatus, asOf)
      totalInvested += s.totalInvested
      totalRealized += s.totalRealized
      totalUnrealized += s.unrealizedValue
      totalFMV += s.fmv
      rows.push({ id: c.id, name: c.name, status: c.status, invested: s.totalInvested, realized: s.totalRealized, fairMarketValue: s.fmv, moic: s.moic, grossIrr: s.grossIrr })
      for (const t of cTxns) {
        if (!t.transaction_date) continue
        const d = new Date(t.transaction_date)
        if (t.transaction_type === 'investment') flows.push({ date: d, amount: -num(t.investment_cost) })
        else if (t.transaction_type === 'proceeds') flows.push({ date: d, amount: num(t.proceeds_received) })
      }
    }
    if (totalUnrealized) flows.push({ date: asOf, amount: totalUnrealized })
    const portfolioMOIC = totalInvested ? (totalRealized + totalUnrealized) / totalInvested : null
    return {
      asOf: asOf.toISOString().slice(0, 10),
      totalInvested,
      totalRealized,
      totalUnrealized,
      totalFairMarketValue: totalFMV,
      portfolioMOIC,
      // Gross fund IRR from investment/proceeds cash flows plus terminal fair
      // value; per-company grossIrr is the authoritative figure.
      grossIrr: flows.length > 1 ? xirr(flows) : null,
      companies: rows.sort((a, b) => b.fairMarketValue - a.fairMarketValue),
    }
  },

  list_deals: async ({ admin, fundId }, input) => {
    let q = admin
      .from('inbound_deals')
      .select('id, company_name, company_url, founder_name, founder_email, intro_source, referrer_name, thesis_fit_score, stage, industry, raise_amount, status, created_at')
      .eq('fund_id', fundId)
      .order('created_at', { ascending: false })
      .limit(clamp(input?.limit, 100, 500))
    if (input?.status) {
      const statuses = String(input.status).split(',').map((s) => s.trim()).filter(Boolean)
      if (statuses.length) q = q.in('status', statuses)
    }
    if (input?.fitScore) q = q.eq('thesis_fit_score', input.fitScore)
    const { data } = await q
    return data ?? []
  },

  list_lps: async ({ admin, fundId }) => {
    const { data } = await admin
      .from('lp_investors' as any)
      .select('id, name, parent_id, lp_entities(id, entity_name)')
      .eq('fund_id', fundId)
      .order('name')
    return data ?? []
  },

  lp_commitments: async ({ admin, fundId }, input) => {
    let snapshotId = input?.snapshotId as string | undefined
    if (!snapshotId) {
      const { data: snap } = await admin
        .from('lp_snapshots' as any)
        .select('id, as_of_date')
        .eq('fund_id', fundId)
        .order('as_of_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      snapshotId = (snap as any)?.id
    }
    let q = admin
      .from('lp_investments' as any)
      .select('portfolio_group, commitment, paid_in_capital, called_capital, distributions, nav, total_value, tvpi, dpi, irr, lp_entities!inner(entity_name, lp_investors!inner(name))')
      .eq('fund_id', fundId)
    if (snapshotId) q = q.eq('snapshot_id', snapshotId)
    const { data } = await q
    return (data ?? []).map((r: any) => ({
      investor: r.lp_entities?.lp_investors?.name ?? null,
      entity: r.lp_entities?.entity_name ?? null,
      vehicle: r.portfolio_group,
      commitment: num(r.commitment),
      paidIn: num(r.paid_in_capital),
      called: num(r.called_capital),
      distributions: num(r.distributions),
      nav: num(r.nav),
      totalValue: num(r.total_value),
      tvpi: r.tvpi != null ? num(r.tvpi) : null,
      dpi: r.dpi != null ? num(r.dpi) : null,
      irr: r.irr != null ? num(r.irr) : null,
    }))
  },

  list_notes: async ({ admin, fundId }, input) => {
    let q = admin
      .from('company_notes')
      .select('id, content, user_id, company_id, created_at, pinned_at')
      .eq('fund_id', fundId)
    if (input?.companyId) q = q.eq('company_id', input.companyId)
    const { data } = await q
      .order('pinned_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(clamp(input?.limit, 100, 200))
    return data ?? []
  },

  list_interactions: async ({ admin, fundId }, input) => {
    let q = admin
      .from('interactions')
      .select('id, company_id, user_id, tags, subject, summary, interaction_date, created_at')
      .eq('fund_id', fundId)
    if (input?.companyId) q = q.eq('company_id', input.companyId)
    if (input?.tag) q = q.contains('tags', [input.tag])
    const { data } = await q.order('interaction_date', { ascending: false }).limit(clamp(input?.limit, 50, 200))
    return data ?? []
  },

  // ---- write handlers ---------------------------------------------------

  add_company: async ({ admin, fundId, userId }, input) => {
    const name = String(input?.name ?? '').trim()
    if (!name) throw new Error('name is required')
    const { data, error } = await admin
      .from('companies')
      .insert({
        fund_id: fundId,
        name,
        stage: input.stage?.trim() || null,
        industry: input.industry ?? null,
        tags: input.tags ?? [],
        overview: input.overview?.trim() || null,
        founders: input.founders?.trim() || null,
        why_invested: input.whyInvested?.trim() || null,
        contact_email: input.contactEmail ?? null,
        portfolio_group: input.portfolioGroup ?? null,
        status: 'active',
      })
      .select('id, name')
      .single()
    if (error) throw new Error(error.message)
    logActivity(admin, fundId, userId, 'company.create', { companyName: name, via: 'mcp' })
    return { id: (data as any).id, name: (data as any).name }
  },

  record_metric_value: async ({ admin, fundId, userId }, input) => {
    if (!input?.companyId) throw new Error('companyId is required')
    if (input.valueNumber == null && !input.valueText) throw new Error('Provide valueNumber or valueText')
    let metricId = input.metricId as string | undefined
    if (!metricId) {
      if (!input.metricSlug) throw new Error('Provide metricId or metricSlug')
      const { data: m } = await admin
        .from('metrics')
        .select('id')
        .eq('company_id', input.companyId)
        .eq('fund_id', fundId)
        .eq('slug', input.metricSlug)
        .maybeSingle()
      if (!m) throw new Error(`No metric with slug "${input.metricSlug}" for this company`)
      metricId = (m as any).id
    }
    const year = Number(input.periodYear)
    if (!Number.isInteger(year)) throw new Error('periodYear must be an integer')
    const q = input.periodQuarter ? `Q${input.periodQuarter} ${year}` : null
    const mo = input.periodMonth ? `${year}-${String(input.periodMonth).padStart(2, '0')}` : null
    const periodLabel = input.periodLabel?.trim() || q || mo || String(year)
    const { data, error } = await admin
      .from('metric_values')
      .insert({
        fund_id: fundId,
        company_id: input.companyId,
        metric_id: metricId,
        period_year: year,
        period_quarter: input.periodQuarter ?? null,
        period_month: input.periodMonth ?? null,
        period_label: periodLabel,
        value_number: input.valueNumber ?? null,
        value_text: input.valueText ?? null,
        notes: input.notes?.trim() || null,
        is_manually_entered: true,
      } as any)
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    logActivity(admin, fundId, userId, 'metric.record', { metricId, period: periodLabel, via: 'mcp' })
    return { id: (data as any).id, period: periodLabel }
  },

  add_note: async ({ admin, fundId, userId }, input) => {
    const content = String(input?.content ?? '').trim()
    if (!content) throw new Error('content is required')
    const { data, error } = await admin
      .from('company_notes')
      .insert({
        fund_id: fundId,
        company_id: input.companyId ?? null,
        user_id: userId,
        content,
        mentioned_user_ids: [],
        mentioned_company_ids: [],
      } as any)
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    logActivity(admin, fundId, userId, 'note.create', { companyId: input.companyId ?? null, via: 'mcp' })
    return { id: (data as any).id }
  },

  add_interaction: async ({ admin, fundId, userId }, input) => {
    const summary = String(input?.summary ?? '').trim()
    if (!summary) throw new Error('summary is required')
    const { data, error } = await admin
      .from('interactions')
      .insert({
        fund_id: fundId,
        user_id: userId,
        company_id: input.companyId ?? null,
        subject: input.subject?.trim() || null,
        summary,
        tags: input.tags ?? [],
        interaction_date: input.interactionDate ? new Date(input.interactionDate).toISOString() : new Date().toISOString(),
      } as any)
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    logActivity(admin, fundId, userId, 'interaction.create', { companyId: input.companyId ?? null, via: 'mcp' })
    return { id: (data as any).id }
  },
}

// Platform tools = manifest + handlers.
export const PLATFORM_TOOLS: McpTool[] = PLATFORM_TOOL_MANIFEST.map((meta: McpToolMeta) => {
  const handler = HANDLERS[meta.name]
  if (!handler) throw new Error(`No MCP handler for tool ${meta.name}`)
  return { ...meta, section: 'platform', handler }
})

// Ledger tools, adapted to the platform context: resolve the vehicle per call
// (the accounting handlers expect a pre-resolved portfolio group). Write tools
// map to the single 'ledger' write category.
function ledgerTools(): McpTool[] {
  return AGENT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    scope: t.scope,
    writeCategory: t.scope === 'write' ? 'ledger' : undefined,
    inputSchema: t.inputSchema,
    section: 'ledger' as const,
    handler: async (ctx: McpToolContext, input: any) => {
      const portfolioGroup = await resolveVehicle(ctx.admin, ctx.fundId, input?.vehicle)
      return t.handler({ admin: ctx.admin, fundId: ctx.fundId, userId: ctx.userId, portfolioGroup }, input)
    },
  }))
}

/**
 * The tools available to a fund, given its MCP config. Platform tools always;
 * ledger tools only when the fund has accounting enabled. This is the full set
 * BEFORE per-key authorization (admin-only / write gating) is applied.
 */
export function buildToolset(config: McpConfig): McpTool[] {
  const tools = [...PLATFORM_TOOLS]
  if (config.accountingEnabled) tools.push(...ledgerTools())
  return tools
}
