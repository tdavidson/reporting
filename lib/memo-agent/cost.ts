import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export type AgentStage = 'ingest' | 'research' | 'qa' | 'draft' | 'score' | 'render'

export interface CostEstimate {
  /** Estimated input tokens — based on character count / 4 (rough) plus per-stage fixed budgets. */
  input_tokens: number
  /** Estimated output tokens. */
  output_tokens: number
  /** Sum of input + output. */
  total_tokens: number
  /** Per-stage explanation for the UI. */
  notes: string[]
}

export interface CapState {
  per_deal_token_cap: number | null
  monthly_token_cap: number | null
  monthly_used: number
  /** Hours of usage covered by `monthly_used` — current calendar month. */
  month_window: { from: string; to: string }
}

export interface EnforceResult {
  ok: boolean
  reason?: string
  estimate: CostEstimate
  caps: CapState
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

const STAGE_OUTPUT_BUDGET: Record<AgentStage, number> = {
  ingest: 12_000,
  research: 12_000,
  qa: 1_500,
  draft: 14_000,
  score: 3_500,
  render: 0,
}

const CHARS_PER_TOKEN = 4 // rough average for English prose

/**
 * Estimate the token spend of running a stage. The estimate is conservative
 * enough to be useful as a guardrail without trying to be precise.
 *
 *   input  = (characters of input / 4) + 2,000 system prompt overhead
 *   output = stage budget (output token ceiling per maxTokens setting)
 *
 * For ingest and research, document content dominates; for qa/draft/score,
 * the upstream output JSON dominates.
 */
export async function estimateStageCost(params: {
  admin: Admin
  fundId: string
  dealId: string
  stage: AgentStage
}): Promise<CostEstimate> {
  const { admin, dealId, stage } = params

  let inputChars = 0
  const notes: string[] = []

  if (stage === 'ingest') {
    const { data } = await admin
      .from('diligence_documents')
      .select('file_size_bytes')
      .eq('deal_id', dealId)
      .neq('parse_status', 'skipped')
    const totalBytes = (data ?? []).reduce((acc: number, r: any) => acc + (r.file_size_bytes ?? 0), 0)
    // Rough: text-y content runs ~0.5x bytes; PDFs are larger but compressed in
    // the prompt. Use a 0.5 multiplier.
    inputChars = Math.round(totalBytes * 0.5)
    notes.push(`${(data ?? []).length} document${(data ?? []).length === 1 ? '' : 's'} (${(totalBytes / 1024 / 1024).toFixed(1)}MB)`)
  } else {
    // For non-ingest stages, base off the stored draft outputs.
    const { data: draft } = await admin
      .from('diligence_memo_drafts')
      .select('ingestion_output, research_output, qa_answers, memo_draft_output')
      .eq('deal_id', dealId)
      .eq('is_draft', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (draft) {
      const json = JSON.stringify(draft)
      inputChars = json.length
      notes.push(`Draft inputs (${(inputChars / 1024).toFixed(1)}KB JSON)`)
    } else {
      notes.push('No prior draft yet')
    }
  }

  const inputTokens = Math.round(inputChars / CHARS_PER_TOKEN) + 2000 // system overhead
  const outputTokens = STAGE_OUTPUT_BUDGET[stage]
  const total = inputTokens + outputTokens

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: total,
    notes,
  }
}

// ---------------------------------------------------------------------------
// Cap state — monthly usage from ai_usage_logs
// ---------------------------------------------------------------------------

const MEMO_AGENT_FEATURES = [
  'memo_agent_ingest',
  'memo_agent_research',
  'memo_agent_qa_batch',
  'memo_agent_draft',
  'memo_agent_score',
]

export async function getCapState(admin: Admin, fundId: string): Promise<CapState> {
  const { data: settings } = await admin
    .from('fund_settings')
    .select('memo_agent_per_deal_token_cap, memo_agent_monthly_token_cap')
    .eq('fund_id', fundId)
    .maybeSingle()
  const perDeal = (settings as any)?.memo_agent_per_deal_token_cap as number | null ?? null
  const monthly = (settings as any)?.memo_agent_monthly_token_cap as number | null ?? null

  // Monthly usage from ai_usage_logs.
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

  const { data: rows } = await admin
    .from('ai_usage_logs')
    .select('input_tokens, output_tokens')
    .eq('fund_id', fundId)
    .in('feature', MEMO_AGENT_FEATURES)
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())

  const used = (rows ?? []).reduce((acc: number, r: any) => acc + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0)

  return {
    per_deal_token_cap: perDeal,
    monthly_token_cap: monthly,
    monthly_used: used,
    month_window: { from: start.toISOString(), to: end.toISOString() },
  }
}

// ---------------------------------------------------------------------------
// Cap enforcement
// ---------------------------------------------------------------------------

export async function enforceCapsForStage(params: {
  admin: Admin
  fundId: string
  dealId: string
  stage: AgentStage
}): Promise<EnforceResult> {
  const [estimate, caps] = await Promise.all([
    estimateStageCost(params),
    getCapState(params.admin, params.fundId),
  ])

  // Monthly cap: would this stage push us past the cap?
  if (caps.monthly_token_cap !== null && caps.monthly_used + estimate.total_tokens > caps.monthly_token_cap) {
    return {
      ok: false,
      reason: `Monthly token cap (${caps.monthly_token_cap.toLocaleString()}) would be exceeded. Used ${caps.monthly_used.toLocaleString()} so far this month; this stage estimates ${estimate.total_tokens.toLocaleString()} more.`,
      estimate,
      caps,
    }
  }

  // Per-deal cap: count tokens already spent on this deal across stages.
  if (caps.per_deal_token_cap !== null) {
    const dealUsed = await getPerDealUsage(params.admin, params.fundId, params.dealId)
    if (dealUsed + estimate.total_tokens > caps.per_deal_token_cap) {
      return {
        ok: false,
        reason: `Per-deal token cap (${caps.per_deal_token_cap.toLocaleString()}) would be exceeded. Used ${dealUsed.toLocaleString()} on this deal; this stage estimates ${estimate.total_tokens.toLocaleString()} more.`,
        estimate,
        caps,
      }
    }
  }

  return { ok: true, estimate, caps }
}

async function getPerDealUsage(admin: Admin, fundId: string, dealId: string): Promise<number> {
  // ai_usage_logs doesn't tag deal_id directly. We approximate by joining via
  // memo_agent_jobs that finished within this deal — returns total tokens
  // logged by the worker for any job belonging to this deal.
  const { data: jobs } = await admin
    .from('memo_agent_jobs')
    .select('started_at, finished_at')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .eq('status', 'success')
    .not('finished_at', 'is', null)
  if (!jobs || jobs.length === 0) return 0

  // Sum logs whose timestamp falls inside any job window. Cheap approximation;
  // fine for the cap check.
  const ranges = (jobs as any[]).map(j => ({ start: j.started_at, end: j.finished_at }))
  const earliest = ranges.reduce((min, r) => (!min || r.start < min ? r.start : min), null as string | null)

  const { data: logs } = await admin
    .from('ai_usage_logs')
    .select('input_tokens, output_tokens, created_at')
    .eq('fund_id', fundId)
    .in('feature', MEMO_AGENT_FEATURES)
    .gte('created_at', earliest ?? new Date(0).toISOString())

  let total = 0
  for (const l of (logs ?? []) as any[]) {
    const ts = l.created_at as string
    if (ranges.some(r => ts >= r.start && (!r.end || ts <= r.end))) {
      total += (l.input_tokens ?? 0) + (l.output_tokens ?? 0)
    }
  }
  return total
}
