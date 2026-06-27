'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { recommendedModel } from '@/lib/ai/recommended'

const STAGES = ['ingest', 'ingest_synthesis', 'checklist_assessment', 'research', 'qa', 'draft', 'draft_review', 'score'] as const
type Stage = typeof STAGES[number]

const FEATURES = ['deal_classify', 'deal_analysis', 'portfolio'] as const
type Feature = typeof FEATURES[number]

const FEATURE_LABEL: Record<Feature, string> = {
  deal_classify: 'Deals — inbound email classifier',
  deal_analysis: 'Deals — deal screening / analysis',
  portfolio: 'Inbound analysis / portfolio tracking',
}

const FEATURE_HINT: Record<Feature, string> = {
  deal_classify: 'Routes every inbound email (reporting / interactions / deals / other). High volume; a fast model is ideal.',
  deal_analysis: 'Screens each pitch — thesis fit, extraction, dedupe. Balanced model recommended.',
  portfolio: 'Extracts company updates and metrics from inbound reporting emails. Balanced model recommended.',
}

const STAGE_LABEL: Record<Stage, string> = {
  ingest: 'Stage 1a, Ingest (per-doc)',
  ingest_synthesis: 'Stage 1b, Ingest synthesis',
  checklist_assessment: 'Stage 1c, Checklist assessment',
  research: 'Stage 2, Research',
  qa: 'Stage 3, Q&A',
  draft: 'Stage 4, Draft (outline + fills)',
  draft_review: 'Stage 4c, Draft review',
  score: 'Stage 5, Score',
}

// Speed-vs-depth tradeoff hint per stage. Stages with heavy structured I/O
// and modest reasoning are good Haiku candidates; stages that produce prose
// or do deep multi-source reasoning are better on Sonnet/Opus.
const STAGE_HINT: Record<Stage, string> = {
  ingest:           'Structured extraction per document. Speed matters; Haiku is a strong fit.',
  ingest_synthesis: 'Small reasoning over summaries (gap analysis + cross-doc flags). Haiku is fine.',
  checklist_assessment: 'Matches data-room findings to each checklist item, in batches. Speed-sensitive; Haiku is a strong fit.',
  research:         'Web-search-heavy verification. Haiku speeds this up dramatically without much quality loss.',
  qa:               'Interactive partner Q&A. Latency-sensitive; Haiku or Sonnet.',
  draft:            'Memo outline + first-draft prose. A mid model (Sonnet) or even Haiku works, the review pass cleans it up.',
  draft_review:     'Reads the first draft and edits it. Use the strongest model here (Opus), this is the quality pass.',
  score:            'Rubric scoring with rationale. Sonnet preferred; Haiku acceptable if quality holds.',
}

const PROVIDER_LABEL: Record<string, string> = {
  '': 'Use fund default',
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama (self-hosted)',
}

const PROVIDER_MODELS_ENDPOINT: Record<string, string> = {
  anthropic: '/api/claude-models',
  openai: '/api/openai-models',
  gemini: '/api/gemini-models',
  ollama: '/api/ollama-models',
}

interface Defaults {
  per_deal_token_cap: number | null
  monthly_token_cap: number | null
  stage_models: Record<string, { provider: string; model?: string } | null>
  feature_models: Record<string, { provider: string; model?: string } | null>
  web_search_enabled: boolean
  default_ai_provider: string
  default_models: Record<string, string>
  export_font_family: string
  export_font_size: number
  monthly_used: number
  month_window: { from: string; to: string }
}

// Common document fonts offered in the export font picker. The export still
// accepts any value the user types, but these cover the usual choices.
const EXPORT_FONT_OPTIONS = [
  'DM Sans', 'Arial', 'Calibri', 'Georgia', 'Helvetica',
  'Inter', 'Lato', 'Times New Roman', 'Verdana',
]

interface AIModel { id: string; name: string }

export function DefaultsEditor({ embedded }: { embedded?: boolean } = {}) {
  const [data, setData] = useState<Defaults | null>(null)
  const [perDeal, setPerDeal] = useState<string>('')
  const [monthly, setMonthly] = useState<string>('')
  const [stageModels, setStageModels] = useState<Record<string, { provider: string; model?: string } | null>>({})
  const [featureModels, setFeatureModels] = useState<Record<string, { provider: string; model?: string } | null>>({})
  const [webSearch, setWebSearch] = useState(false)
  const [exportFont, setExportFont] = useState('DM Sans')
  const [exportFontSize, setExportFontSize] = useState('11')
  const [dgTesting, setDgTesting] = useState(false)
  const [dgResult, setDgResult] = useState<{
    deepgram: { ok: boolean; detail: string }
    webhook_secret_set: boolean
    webhook_url_resolvable: boolean
    ready: boolean
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Model dropdowns load from the active provider for each stage. Cached
  // per provider since multiple stages may pick the same one.
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, AIModel[]>>({})
  const [loadingProviders, setLoadingProviders] = useState<Set<string>>(new Set())

  async function load() {
    const res = await fetch('/api/firm/memo-agent-defaults')
    if (res.ok) {
      const body: Defaults = await res.json()
      setData(body)
      setPerDeal(body.per_deal_token_cap !== null ? String(body.per_deal_token_cap) : '')
      setMonthly(body.monthly_token_cap !== null ? String(body.monthly_token_cap) : '')
      setStageModels(body.stage_models ?? {})
      setFeatureModels(body.feature_models ?? {})
      setWebSearch(!!body.web_search_enabled)
      setExportFont(body.export_font_family || 'DM Sans')
      setExportFontSize(String(body.export_font_size || 11))
    }
  }

  async function loadModelsFor(provider: string) {
    if (!provider || modelsByProvider[provider] || loadingProviders.has(provider)) return
    const endpoint = PROVIDER_MODELS_ENDPOINT[provider]
    if (!endpoint) return
    setLoadingProviders(prev => new Set(prev).add(provider))
    try {
      const res = await fetch(endpoint)
      const body = await res.json().catch(() => ({}))
      const models: AIModel[] = Array.isArray(body?.models) ? body.models : []
      setModelsByProvider(prev => ({ ...prev, [provider]: models }))
    } catch {
      // Leave models empty so the UI falls back to freeform input.
      setModelsByProvider(prev => ({ ...prev, [provider]: [] }))
    } finally {
      setLoadingProviders(prev => { const next = new Set(prev); next.delete(provider); return next })
    }
  }

  useEffect(() => { load() }, [])

  // Pre-load models for any providers already configured on save load.
  useEffect(() => {
    const providers = new Set<string>()
    for (const v of Object.values(stageModels)) if (v?.provider) providers.add(v.provider)
    for (const v of Object.values(featureModels)) if (v?.provider) providers.add(v.provider)
    providers.forEach(loadModelsFor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageModels, featureModels])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/firm/memo-agent-defaults', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          per_deal_token_cap: perDeal === '' ? null : Number(perDeal),
          monthly_token_cap: monthly === '' ? null : Number(monthly),
          stage_models: stageModels,
          feature_models: featureModels,
          web_search_enabled: webSearch,
          export_font_family: exportFont,
          export_font_size: exportFontSize === '' ? 11 : Number(exportFontSize),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Save failed')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function setStage(stage: Stage, provider: string, model?: string) {
    setStageModels(prev => ({
      ...prev,
      [stage]: provider ? { provider, ...(model ? { model } : {}) } : null,
    }))
    if (provider) loadModelsFor(provider)
  }

  function setFeature(feature: Feature, provider: string, model?: string) {
    setFeatureModels(prev => ({
      ...prev,
      [feature]: provider ? { provider, ...(model ? { model } : {}) } : null,
    }))
    if (provider) loadModelsFor(provider)
  }

  async function testTranscription() {
    setDgTesting(true)
    setDgResult(null)
    try {
      const res = await fetch('/api/transcription/test')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Test failed')
      setDgResult(body)
    } catch (err) {
      setDgResult({
        deepgram: { ok: false, detail: err instanceof Error ? err.message : 'Test failed' },
        webhook_secret_set: false,
        webhook_url_resolvable: false,
        ready: false,
      })
    } finally {
      setDgTesting(false)
    }
  }

  if (!data) return <div className="p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>

  const monthName = new Date(data.month_window.from).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const monthlyPct = data.monthly_token_cap ? Math.min(100, (data.monthly_used / data.monthly_token_cap) * 100) : 0

  return (
    <div className={embedded ? '' : 'p-4 md:py-8 md:pl-8 md:pr-4 max-w-4xl'}>
      {!embedded && (
        <>
          <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to settings
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Diligence Defaults</h1>
          <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
            Cost guardrails and per-stage AI provider overrides. Caps are checked before each agent
            stage runs; if the estimate would exceed a cap, the run is blocked.
          </p>
        </>
      )}

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive mb-4">{error}</div>}

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Token caps</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Per-deal cap</label>
                <Input
                  type="number"
                  value={perDeal}
                  onChange={e => setPerDeal(e.target.value)}
                  placeholder="(unlimited)"
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Maximum total tokens (input + output) across all stages for a single deal. Blank = no cap.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Monthly cap (fund-wide)</label>
                <Input
                  type="number"
                  value={monthly}
                  onChange={e => setMonthly(e.target.value)}
                  placeholder="(unlimited)"
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Tracks the calendar month. Resets at month rollover.
                </p>
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium">{monthName}, usage</span>
                <span className="font-mono text-muted-foreground">
                  {data.monthly_used.toLocaleString()}{data.monthly_token_cap ? ` / ${data.monthly_token_cap.toLocaleString()}` : ''} tokens
                </span>
              </div>
              {data.monthly_token_cap && (
                <div className="h-1.5 bg-background rounded overflow-hidden">
                  <div
                    className={`h-full ${monthlyPct > 90 ? 'bg-red-500' : monthlyPct > 70 ? 'bg-amber-500' : 'bg-primary'}`}
                    style={{ width: `${monthlyPct}%` }}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Per-stage AI provider &amp; model</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-4">
            <p className="text-xs text-muted-foreground max-w-3xl">
              Override the fund&apos;s default on a per-stage basis. Use a fast model (e.g. Haiku) for
              high-volume structured stages, and a strong model (e.g. Sonnet or Opus) for prose-heavy
              ones like draft. A stage left on &ldquo;Use fund default&rdquo; runs the fund default:{' '}
              <span className="font-mono">{data.default_ai_provider} · {data.default_models[data.default_ai_provider] ?? '—'}</span>.
            </p>

            <div className="space-y-3">
              {STAGES.map(stage => {
                const current = stageModels[stage]
                const provider = current?.provider ?? ''
                const models = provider ? modelsByProvider[provider] : undefined
                const loading = provider ? loadingProviders.has(provider) : false
                // Effective provider + model actually running for this stage.
                const effProvider = provider || data.default_ai_provider
                const effModel = current?.model
                  ? current.model
                  : provider
                    ? (data.default_models[effProvider] ?? '—')
                    : recommendedModel(stage, effProvider, data.default_models[effProvider] ?? '—')
                const effSource = !provider ? 'recommended default' : (current?.model ? 'override' : 'override · provider default model')
                return (
                  <div key={stage} className="rounded-md border bg-card p-3">
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <div>
                        <div className="text-sm font-medium">{STAGE_LABEL[stage]}</div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl">{STAGE_HINT[stage]}</p>
                      </div>
                      <div className="shrink-0 text-right text-[11px] leading-tight">
                        <div className="font-mono">{effProvider} · {effModel}</div>
                        <div className="text-muted-foreground">{effSource}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-[1fr_1fr] gap-2">
                      <select
                        value={provider}
                        onChange={e => setStage(stage, e.target.value, undefined)}
                        className="h-9 px-2 rounded-md border border-input bg-background text-sm"
                      >
                        {Object.entries(PROVIDER_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                      </select>
                      {provider ? (
                        models && models.length > 0 ? (
                          <select
                            value={current?.model ?? ''}
                            onChange={e => setStage(stage, provider, e.target.value || undefined)}
                            className="h-9 px-2 rounded-md border border-input bg-background text-sm font-mono"
                          >
                            <option value="">(provider default)</option>
                            {models.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                          </select>
                        ) : (
                          <Input
                            value={current?.model ?? ''}
                            onChange={e => setStage(stage, provider, e.target.value || undefined)}
                            placeholder={loading ? 'Loading models…' : `Model id (defaults to fund's ${provider} model)`}
                            className="font-mono text-xs"
                            disabled={loading}
                          />
                        )
                      ) : (
                        <Input value="" disabled placeholder="Set provider first" className="font-mono text-xs" />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Deals &amp; portfolio AI provider &amp; model</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-4">
            <p className="text-xs text-muted-foreground max-w-3xl">
              These features run outside the memo agent. Left on &ldquo;Use fund default&rdquo;, each runs its
              recommended model tier on the fund default provider.
            </p>
            <div className="space-y-3">
              {FEATURES.map(feature => {
                const current = featureModels[feature]
                const provider = current?.provider ?? ''
                const models = provider ? modelsByProvider[provider] : undefined
                const loading = provider ? loadingProviders.has(provider) : false
                const effProvider = provider || data.default_ai_provider
                const effModel = current?.model
                  ? current.model
                  : provider
                    ? (data.default_models[effProvider] ?? '—')
                    : recommendedModel(feature, effProvider, data.default_models[effProvider] ?? '—')
                const effSource = !provider ? 'recommended default' : (current?.model ? 'override' : 'override · provider default model')
                return (
                  <div key={feature} className="rounded-md border bg-card p-3">
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <div>
                        <div className="text-sm font-medium">{FEATURE_LABEL[feature]}</div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl">{FEATURE_HINT[feature]}</p>
                      </div>
                      <div className="shrink-0 text-right text-[11px] leading-tight">
                        <div className="font-mono">{effProvider} · {effModel}</div>
                        <div className="text-muted-foreground">{effSource}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-[1fr_1fr] gap-2">
                      <select
                        value={provider}
                        onChange={e => setFeature(feature, e.target.value, undefined)}
                        className="h-9 px-2 rounded-md border border-input bg-background text-sm"
                      >
                        {Object.entries(PROVIDER_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                      </select>
                      {provider ? (
                        models && models.length > 0 ? (
                          <select
                            value={current?.model ?? ''}
                            onChange={e => setFeature(feature, provider, e.target.value || undefined)}
                            className="h-9 px-2 rounded-md border border-input bg-background text-sm font-mono"
                          >
                            <option value="">(provider default)</option>
                            {models.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                          </select>
                        ) : (
                          <Input
                            value={current?.model ?? ''}
                            onChange={e => setFeature(feature, provider, e.target.value || undefined)}
                            placeholder={loading ? 'Loading models…' : `Model id (defaults to fund's ${provider} model)`}
                            className="font-mono text-xs"
                            disabled={loading}
                          />
                        )
                      ) : (
                        <Input value="" disabled placeholder="Set provider first" className="font-mono text-xs" />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Research stage, web search</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={webSearch}
                onChange={e => setWebSearch(e.target.checked)}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <div className="font-medium">Enable Anthropic web search during research</div>
                <p className="text-xs text-muted-foreground max-w-2xl">
                  When on, Stage 2 attaches Anthropic&apos;s <span className="font-mono">web_search</span> tool so the
                  agent can verify claims against external sources and cite URLs in findings. Only active when the
                  research stage is running on Anthropic. <span className="font-medium text-foreground">Adds external billing
                  </span> at Anthropic&apos;s rate (~$10 per 1,000 searches) on top of token usage; capped at 5 searches per run.
                </p>
              </div>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Memo export formatting</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-3">
            <p className="text-xs text-muted-foreground max-w-2xl">
              Base font and size for Word / Google Doc exports. Headings scale from the base size.
              Citations and the appendix are omitted from exported documents.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Base font</label>
                <input
                  list="export-font-options"
                  value={exportFont}
                  onChange={e => setExportFont(e.target.value)}
                  placeholder="DM Sans"
                  className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm"
                />
                <datalist id="export-font-options">
                  {EXPORT_FONT_OPTIONS.map(f => <option key={f} value={f} />)}
                </datalist>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Any font name is accepted. Google Docs renders web fonts like DM Sans natively; Word
                  substitutes if the font isn&apos;t installed locally.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Base font size (pt)</label>
                <Input
                  type="number"
                  min={6}
                  max={32}
                  value={exportFontSize}
                  onChange={e => setExportFontSize(e.target.value)}
                  placeholder="11"
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Body text size. 6–32pt.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Call transcription (Deepgram)</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-3">
            <p className="text-xs text-muted-foreground max-w-2xl">
              Audio/video recordings uploaded to a deal&apos;s data room are transcribed via Deepgram.
              Test that the API key and webhook environment are configured correctly.
            </p>
            <Button variant="outline" size="sm" onClick={testTranscription} disabled={dgTesting}>
              {dgTesting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
              Test Deepgram connection
            </Button>
            {dgResult && (
              <div className="rounded-md border bg-muted/20 p-3 space-y-1.5 text-xs">
                <ResultRow ok={dgResult.deepgram.ok} label="Deepgram API" detail={dgResult.deepgram.detail} />
                <ResultRow
                  ok={dgResult.webhook_secret_set}
                  label="Webhook secret"
                  detail={dgResult.webhook_secret_set ? 'TRANSCRIPTION_WEBHOOK_SECRET is set.' : 'TRANSCRIPTION_WEBHOOK_SECRET is missing.'}
                />
                <ResultRow
                  ok={dgResult.webhook_url_resolvable}
                  label="Webhook URL"
                  detail={dgResult.webhook_url_resolvable ? 'A callback base URL is resolvable.' : 'No callback base URL (set TRANSCRIPTION_WEBHOOK_URL or NEXT_PUBLIC_SITE_URL).'}
                />
                <div className={`pt-1 font-medium ${dgResult.ready ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {dgResult.ready ? 'Transcription is ready to use.' : 'Transcription is not fully configured.'}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : saved ? <Check className="h-4 w-4 mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {saved ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ResultRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
        {ok ? '\u2713' : '\u2717'}
      </span>
      <div className="min-w-0">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{` \u2014 ${detail}`}</span>
      </div>
    </div>
  )
}
