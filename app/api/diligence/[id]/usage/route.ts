import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Approximate list pricing in USD per 1M tokens, matched by model-name
// substring. Kept here (not the DB) so it's easy to update; reporting is
// indicative, not billing-grade.
function priceFor(model: string): { in: number; out: number } {
  const m = (model || '').toLowerCase()
  // Anthropic (Claude)
  if (m.includes('opus')) return { in: 15, out: 75 }
  if (m.includes('haiku')) return { in: 0.8, out: 4 }
  if (m.includes('sonnet')) return { in: 3, out: 15 }
  // OpenAI
  if (m.includes('gpt-4o-mini') || m.includes('gpt-4.1-mini') || m.includes('gpt-5-mini')) return { in: 0.15, out: 0.6 }
  if (m.includes('gpt-4o') || m.includes('gpt-4.1') || m.includes('gpt-5')) return { in: 2.5, out: 10 }
  // Google Gemini
  if (m.includes('gemini') && m.includes('pro')) return { in: 1.25, out: 10 }
  if (m.includes('gemini')) return { in: 0.3, out: 2.5 } // flash tiers
  // Inexpensive open models (typically via OpenRouter)
  if (m.includes('deepseek')) return { in: 0.3, out: 1.1 }
  if (m.includes('glm')) return { in: 0.4, out: 1.6 }
  if (m.includes('qwen')) return { in: 0.3, out: 1.2 }
  // Local / self-hosted (Ollama) — no marginal API cost
  if (m.includes('ollama') || m.includes('llama') || m.includes('mistral') || m.includes('phi')) return { in: 0, out: 0 }
  return { in: 3, out: 15 } // sensible default (~Sonnet tier)
}

// Cache pricing relative to the base input rate: writes ~1.25x, reads ~0.1x.
const CACHE_WRITE_MULT = 1.25
const CACHE_READ_MULT = 0.1

function costUsd(model: string, input: number, output: number, cacheRead = 0, cacheCreate = 0): number {
  const p = priceFor(model)
  return (input / 1_000_000) * p.in
    + (cacheCreate / 1_000_000) * p.in * CACHE_WRITE_MULT
    + (cacheRead / 1_000_000) * p.in * CACHE_READ_MULT
    + (output / 1_000_000) * p.out
}

// What the cache reads would have cost at the full input rate, minus what they
// actually cost — i.e. the dollars saved by caching.
function cacheSavedUsd(model: string, cacheRead: number): number {
  return (cacheRead / 1_000_000) * priceFor(model).in * (1 - CACHE_READ_MULT)
}

/**
 * Per-deal AI usage report: tokens + estimated cost (from ai_usage_logs) and
 * processing time (from memo_agent_jobs durations). Optional ?days=N window.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  const fundId = (membership as any).fund_id as string

  const daysParam = Number(req.nextUrl.searchParams.get('days'))
  const since = Number.isFinite(daysParam) && daysParam > 0
    ? new Date(Date.now() - daysParam * 86_400_000).toISOString()
    : null

  // --- Token spend, by feature ---
  // Cast: cache_* are recently-added columns not yet in the generated types.
  let usageQuery = (admin as any)
    .from('ai_usage_logs')
    .select('feature, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, created_at')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
  if (since) usageQuery = usageQuery.gte('created_at', since)
  const { data: usageRows, error: usageErr } = await usageQuery
  if (usageErr) return NextResponse.json({ error: usageErr.message }, { status: 500 })

  const byFeature = new Map<string, { feature: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number }>()
  const byModel = new Map<string, { model: string; calls: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number }>()
  let totalInput = 0, totalOutput = 0, totalCost = 0, totalCalls = 0
  let totalCacheRead = 0, totalCacheCreation = 0, totalCacheSaved = 0
  for (const r of (usageRows ?? []) as Array<{ feature: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number }>) {
    const inp = r.input_tokens ?? 0
    const out = r.output_tokens ?? 0
    const cr = r.cache_read_tokens ?? 0
    const cc = r.cache_creation_tokens ?? 0
    const c = costUsd(r.model, inp, out, cr, cc)
    totalInput += inp; totalOutput += out; totalCost += c; totalCalls += 1
    totalCacheRead += cr; totalCacheCreation += cc; totalCacheSaved += cacheSavedUsd(r.model, cr)
    const cur = byFeature.get(r.feature) ?? { feature: r.feature, calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 }
    cur.calls += 1; cur.input_tokens += inp; cur.output_tokens += out; cur.cost_usd += c
    byFeature.set(r.feature, cur)
    const mk = r.model || 'unknown'
    const cm = byModel.get(mk) ?? { model: mk, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cost_usd: 0 }
    cm.calls += 1; cm.input_tokens += inp; cm.output_tokens += out; cm.cache_read_tokens += cr; cm.cost_usd += c
    byModel.set(mk, cm)
  }

  // --- Processing time, from job durations, by kind ---
  let jobQuery = admin
    .from('memo_agent_jobs')
    .select('kind, status, started_at, finished_at')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .not('started_at', 'is', null)
    .not('finished_at', 'is', null)
  if (since) jobQuery = jobQuery.gte('started_at', since)
  const { data: jobRows } = await jobQuery

  const byStage = new Map<string, { kind: string; runs: number; processing_ms: number }>()
  let totalMs = 0, totalJobs = 0
  for (const j of (jobRows ?? []) as Array<{ kind: string; started_at: string; finished_at: string }>) {
    const ms = new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()
    if (!Number.isFinite(ms) || ms < 0) continue
    totalMs += ms; totalJobs += 1
    const cur = byStage.get(j.kind) ?? { kind: j.kind, runs: 0, processing_ms: 0 }
    cur.runs += 1; cur.processing_ms += ms
    byStage.set(j.kind, cur)
  }

  return NextResponse.json({
    window_days: since ? daysParam : null,
    total: {
      input_tokens: totalInput,
      output_tokens: totalOutput,
      total_tokens: totalInput + totalOutput,
      cost_usd: totalCost,
      calls: totalCalls,
      processing_ms: totalMs,
      jobs: totalJobs,
      cache_read_tokens: totalCacheRead,
      cache_creation_tokens: totalCacheCreation,
      cache_saved_usd: totalCacheSaved,
    },
    by_feature: Array.from(byFeature.values()).sort((a, b) => b.cost_usd - a.cost_usd),
    by_model: Array.from(byModel.values()).sort((a, b) => b.cost_usd - a.cost_usd),
    by_stage: Array.from(byStage.values()).sort((a, b) => b.processing_ms - a.processing_ms),
  })
}
