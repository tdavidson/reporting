'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Loader2, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConfirm } from '@/components/confirm-dialog'

export type MemoComplexity = 'brief' | 'standard' | 'detailed' | 'comprehensive'

export interface MemoTemplateConfig {
  style_override?: 'pre_seed' | 'seed' | 'series_a' | 'series_b' | 'growth' | null
  analyst_persona?: string
  complexity?: MemoComplexity
  emphasis?: string[]
  section_overrides?: Record<string, { included?: boolean; target_paragraphs?: number | null }>
}

// Section list mirrors the memo editor — keep these in sync if the schema
// section IDs ever change. Order matches the editor for partner mental model.
const SECTIONS: Array<{ id: string; title: string; defaultParagraphs: number }> = [
  { id: 'executive_summary', title: 'Executive Summary', defaultParagraphs: 2 },
  { id: 'recommendation', title: 'Recommendation', defaultParagraphs: 1 },
  { id: 'company_overview', title: 'Company Overview', defaultParagraphs: 2 },
  { id: 'market', title: 'Market', defaultParagraphs: 3 },
  { id: 'team', title: 'Team', defaultParagraphs: 2 },
  { id: 'product_technology', title: 'Product & Technology', defaultParagraphs: 3 },
  { id: 'traction', title: 'Traction & Evidence', defaultParagraphs: 3 },
  { id: 'business_model', title: 'Business Model & Financials', defaultParagraphs: 3 },
  { id: 'competition_moat', title: 'Competition & Moat', defaultParagraphs: 2 },
  { id: 'deal_terms', title: 'Deal & Terms', defaultParagraphs: 2 },
  { id: 'risks_and_open_questions', title: 'Risks & Open Questions', defaultParagraphs: 2 },
]

const STYLE_OPTIONS: Array<{ value: '' | NonNullable<MemoTemplateConfig['style_override']>; label: string }> = [
  { value: '',          label: 'Deal default (use stage_at_consideration)' },
  { value: 'pre_seed',  label: 'Pre-seed' },
  { value: 'seed',      label: 'Seed' },
  { value: 'series_a',  label: 'Series A' },
  { value: 'series_b',  label: 'Series B' },
  { value: 'growth',    label: 'Growth' },
]

// Curated analyst-voice presets. Stored verbatim as analyst_persona and fed to
// the agent prompt. "Custom…" reveals a free-text field for anything bespoke.
const PERSONA_PRESETS = [
  'Balanced generalist',
  'Skeptical, numbers-first',
  'Conviction-driven (bull case)',
  'Risk-focused (bear case)',
  'Founder-empathetic operator',
  'Market/TAM-first',
]

// Single proxy for completeness, depth, and length — replaces per-section
// paragraph counts. Order runs shortest → most thorough.
const COMPLEXITY_OPTIONS: Array<{ value: MemoComplexity; label: string; hint: string }> = [
  { value: 'brief',         label: 'Brief',         hint: 'Concise, key points only' },
  { value: 'standard',      label: 'Standard',      hint: 'Standard depth (default)' },
  { value: 'detailed',      label: 'Detailed',      hint: 'Thorough, more evidence' },
  { value: 'comprehensive', label: 'Comprehensive', hint: 'Exhaustive, maximum depth' },
]

interface MemoPreset {
  id: string
  name: string
  description: string | null
  partner_memo_guidance: string
  memo_template_config: MemoTemplateConfig
  default_for_stage: string | null
}

export function MemoConfigPanel({ dealId }: { dealId: string }) {
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [partnerGuidance, setPartnerGuidance] = useState('')
  const [styleOverride, setStyleOverride] = useState<'' | NonNullable<MemoTemplateConfig['style_override']>>('')
  const [persona, setPersona] = useState('')
  const [personaCustom, setPersonaCustom] = useState(false)
  const [complexity, setComplexity] = useState<MemoComplexity>('standard')
  const [emphasis, setEmphasis] = useState<string[]>([])
  const [emphasisDraft, setEmphasisDraft] = useState('')
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, { included: boolean; target_paragraphs: number | null }>>({})

  // Presets — fund-level saved configs.
  const [presets, setPresets] = useState<MemoPreset[]>([])
  const [savePresetOpen, setSavePresetOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetDefaultFor, setPresetDefaultFor] = useState<'' | NonNullable<MemoTemplateConfig['style_override']>>('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`/api/diligence/${dealId}/memo-config`).then(r => r.ok ? r.json() : Promise.reject(new Error('config'))),
      fetch('/api/diligence/memo-presets').then(r => r.ok ? r.json() : Promise.reject(new Error('presets'))),
    ])
      .then(([cfgBody, presetBody]) => {
        if (cancelled) return
        applyConfigToForm(cfgBody.partner_memo_guidance ?? '', (cfgBody.memo_template_config ?? {}) as MemoTemplateConfig)
        setPresets((presetBody.presets ?? []) as MemoPreset[])
        setLoaded(true)
      })
      .catch(() => { setError('Failed to load memo settings.'); setLoaded(true) })
    return () => { cancelled = true }
  }, [dealId])

  function applyConfigToForm(guidance: string, cfg: MemoTemplateConfig) {
    setPartnerGuidance(guidance)
    setStyleOverride((cfg.style_override ?? '') as any)
    const p = cfg.analyst_persona ?? ''
    setPersona(p)
    setPersonaCustom(!!p && !PERSONA_PRESETS.includes(p))
    setComplexity(cfg.complexity ?? 'standard')
    setEmphasis(Array.isArray(cfg.emphasis) ? cfg.emphasis : [])
    const ov: Record<string, { included: boolean; target_paragraphs: number | null }> = {}
    for (const s of SECTIONS) {
      const o = cfg.section_overrides?.[s.id]
      ov[s.id] = {
        included: o?.included !== false,
        target_paragraphs: typeof o?.target_paragraphs === 'number' ? o.target_paragraphs : null,
      }
    }
    setSectionOverrides(ov)
  }

  function currentConfig(): MemoTemplateConfig {
    return {
      style_override: (styleOverride || null) as MemoTemplateConfig['style_override'],
      analyst_persona: persona,
      complexity,
      emphasis,
      section_overrides: Object.fromEntries(
        SECTIONS.map(s => [s.id, { included: sectionOverrides[s.id]?.included ?? true }]),
      ),
    }
  }

  function loadPreset(presetId: string) {
    const p = presets.find(p => p.id === presetId)
    if (!p) return
    applyConfigToForm(p.partner_memo_guidance ?? '', p.memo_template_config ?? {})
  }

  async function savePreset() {
    const name = presetName.trim()
    if (!name) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/diligence/memo-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          partner_memo_guidance: partnerGuidance,
          memo_template_config: currentConfig(),
          default_for_stage: presetDefaultFor || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Save failed')
      // Refresh presets list — easier than splice-merging the swap-cleanup the
      // server may have done if default_for_stage took an existing slot.
      const refreshed = await fetch('/api/diligence/memo-presets').then(r => r.ok ? r.json() : { presets: [] })
      setPresets((refreshed.presets ?? []) as MemoPreset[])
      setSavePresetOpen(false)
      setPresetName('')
      setPresetDefaultFor('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function deletePreset(presetId: string) {
    const p = presets.find(p => p.id === presetId)
    const ok = await confirm({
      title: 'Delete preset?',
      description: p ? `Removes "${p.name}" from this fund. Deals already using it keep their config.` : 'Removes this preset.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    const res = await fetch(`/api/diligence/memo-presets/${presetId}`, { method: 'DELETE' })
    if (res.ok) setPresets(prev => prev.filter(p => p.id !== presetId))
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      const config = currentConfig()
      const res = await fetch(`/api/diligence/${dealId}/memo-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_memo_guidance: partnerGuidance,
          memo_template_config: config,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Save failed')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ---- helpers ----
  function setSection(id: string, patch: Partial<{ included: boolean; target_paragraphs: number | null }>) {
    setSectionOverrides(prev => ({
      ...prev,
      [id]: { ...(prev[id] ?? { included: true, target_paragraphs: null }), ...patch },
    }))
  }
  function addEmphasis() {
    const v = emphasisDraft.trim()
    if (!v) return
    setEmphasis(prev => [...prev, v])
    setEmphasisDraft('')
  }
  function removeEmphasis(i: number) {
    setEmphasis(prev => prev.filter((_, idx) => idx !== i))
  }

  const includedCount = Object.values(sectionOverrides).filter(o => o?.included).length
  const summary = !loaded
    ? 'Loading…'
    : [
        styleOverride && STYLE_OPTIONS.find(s => s.value === styleOverride)?.label,
        COMPLEXITY_OPTIONS.find(c => c.value === complexity)?.label.toLowerCase(),
        persona ? `persona: ${persona.length > 30 ? persona.slice(0, 30) + '…' : persona}` : null,
        emphasis.length > 0 ? `${emphasis.length} emphasis point${emphasis.length === 1 ? '' : 's'}` : null,
        `${includedCount}/${SECTIONS.length} sections`,
      ].filter(Boolean).join(' · ')

  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="flex items-center gap-2">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="font-medium text-sm">Memo settings</span>
        </span>
        <span className="text-xs text-muted-foreground truncate ml-4">{summary}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t space-y-4">
          {error && <div className="text-xs text-destructive">{error}</div>}

          {/* Preset toolbar — load a saved fund preset into the form, or save
              the current form state as a new preset. The form below is still
              the source of truth that gets PATCHed to the deal on Save. */}
          <div className="rounded-md border bg-muted/20 px-3 py-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium">Preset:</label>
              <select
                onChange={e => { if (e.target.value) loadPreset(e.target.value) }}
                defaultValue=""
                className="h-7 rounded border border-input bg-background px-2 text-xs min-w-[200px]"
              >
                <option value="">Load a saved preset…</option>
                {presets.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.default_for_stage ? ` (default for ${p.default_for_stage.replace('_', ' ')})` : ''}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={() => setSavePresetOpen(o => !o)}>
                Save as preset…
              </Button>
              {presets.length > 0 && (
                <span className="text-[11px] text-muted-foreground ml-auto">{presets.length} preset{presets.length === 1 ? '' : 's'} on file</span>
              )}
            </div>
            {savePresetOpen && (
              <div className="space-y-2 pt-2 border-t">
                <div className="flex flex-wrap gap-2 items-center">
                  <Input
                    value={presetName}
                    onChange={e => setPresetName(e.target.value)}
                    placeholder="Preset name (e.g. 'Our seed memo style')"
                    className="h-8 text-sm flex-1 min-w-[200px]"
                  />
                  <select
                    value={presetDefaultFor}
                    onChange={e => setPresetDefaultFor(e.target.value as any)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    title="Auto-apply to new deals at this stage"
                  >
                    <option value="">Not a default</option>
                    <option value="pre_seed">Default for pre-seed</option>
                    <option value="seed">Default for seed</option>
                    <option value="series_a">Default for Series A</option>
                    <option value="series_b">Default for Series B</option>
                    <option value="growth">Default for growth</option>
                  </select>
                  <Button size="sm" onClick={savePreset} disabled={saving || !presetName.trim()}>
                    {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />} Save preset
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setSavePresetOpen(false); setPresetName(''); setPresetDefaultFor('') }}>Cancel</Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Saves the current form state (style, persona, emphasis, sections, guidance) as a reusable preset. Marking it the default for a stage auto-applies it to new deals at that stage.
                </p>
              </div>
            )}
            {presets.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Manage presets</summary>
                <div className="mt-2 space-y-1 pl-2">
                  {presets.map(p => (
                    <div key={p.id} className="flex items-center gap-2">
                      <span className="font-medium truncate flex-1">{p.name}</span>
                      {p.default_for_stage && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">default · {p.default_for_stage.replace('_', ' ')}</span>}
                      <button onClick={() => deletePreset(p.id)} className="text-muted-foreground hover:text-destructive" aria-label="Delete preset" title="Delete preset">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium mb-1">Style</label>
              <select
                value={styleOverride}
                onChange={e => setStyleOverride(e.target.value as any)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {STYLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">Calibrates expectations and tone. Overrides the deal&apos;s stage when set.</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Analyst persona</label>
              <select
                value={personaCustom ? '__custom__' : (persona && PERSONA_PRESETS.includes(persona) ? persona : (persona ? '__custom__' : ''))}
                onChange={e => {
                  const v = e.target.value
                  if (v === '') { setPersonaCustom(false); setPersona('') }
                  else if (v === '__custom__') { setPersonaCustom(true) }
                  else { setPersonaCustom(false); setPersona(v) }
                }}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">No persona (default voice)</option>
                {PERSONA_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
                <option value="__custom__">Custom…</option>
              </select>
              {personaCustom && (
                <Input
                  value={persona}
                  onChange={e => setPersona(e.target.value)}
                  placeholder="e.g. skeptical numbers-first analyst"
                  className="h-8 text-sm mt-1.5"
                  autoFocus
                />
              )}
              <p className="text-[10px] text-muted-foreground mt-1">The voice the agent writes in. Pick a preset, or choose Custom to describe your own.</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Points to emphasize</label>
            <div className="flex gap-2 mb-2">
              <Input
                value={emphasisDraft}
                onChange={e => setEmphasisDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmphasis() } }}
                placeholder="e.g. data privacy posture; founder coachability; CAC trajectory"
                className="h-8 text-sm"
              />
              <Button size="sm" variant="outline" onClick={addEmphasis} disabled={!emphasisDraft.trim()}>Add</Button>
            </div>
            {emphasis.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {emphasis.map((e, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-muted/40 text-xs">
                    {e}
                    <button onClick={() => removeEmphasis(i)} className="text-muted-foreground hover:text-destructive" aria-label="Remove">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Complexity</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {COMPLEXITY_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setComplexity(o.value)}
                  className={`rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${complexity === o.value ? 'border-foreground bg-muted' : 'border-input hover:bg-muted/40'}`}
                  aria-pressed={complexity === o.value}
                >
                  <div className="font-medium">{o.label}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{o.hint}</div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Sets completeness, depth of evidence, and length across the whole memo.</p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Sections</label>
            <div className="rounded-md border divide-y">
              {SECTIONS.map(s => {
                const ov = sectionOverrides[s.id] ?? { included: true, target_paragraphs: null }
                return (
                  <label key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ov.included}
                      onChange={e => setSection(s.id, { included: e.target.checked })}
                      className="h-3.5 w-3.5"
                    />
                    <span className="font-medium truncate flex-1 min-w-0">{s.title}</span>
                  </label>
                )
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Unchecked sections are omitted entirely from the memo. Length and depth are driven by Complexity above.</p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Additional guidance for this memo</label>
            <textarea
              value={partnerGuidance}
              onChange={e => setPartnerGuidance(e.target.value)}
              rows={4}
              placeholder="Adds to the fund's draft-stage guidance from settings. Use for deal-specific direction — e.g. &quot;tilt analysis toward technical defensibility, downplay GTM strategy.&quot;"
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : saved ? <Save className="h-3.5 w-3.5 mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              {saved ? 'Saved' : 'Save settings'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
