'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Loader2, Check, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Anchor {
  id: string
  fund_id: string
  storage_path: string
  file_name: string
  file_format: string
  file_size_bytes: number | null
  title: string | null
  anonymized: boolean
  vintage_year: number | null
  vintage_quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
  sector: string | null
  deal_stage_at_writing: string | null
  outcome: 'invested' | 'passed' | 'lost_competitive' | 'withdrew' | 'unknown' | null
  conviction_at_writing: 'high' | 'medium' | 'low' | 'mixed' | null
  voice_representativeness: 'exemplary' | 'representative' | 'atypical' | 'do_not_match_voice'
  authorship: string | null
  author_initials: string | null
  focus_attention_on: string[] | null
  deprioritize_in_this_memo: string[] | null
  partner_notes: string | null
  extracted_text: string | null
  extracted_at: string | null
  uploaded_at: string
}

export function AnchorEditor({ anchor: initial }: { anchor: Anchor }) {
  const router = useRouter()
  const [a, setA] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof Anchor>(key: K, value: Anchor[K]) {
    setA(prev => ({ ...prev, [key]: value }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/firm/style-anchors/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: a.title,
          anonymized: a.anonymized,
          vintage_year: a.vintage_year,
          vintage_quarter: a.vintage_quarter,
          sector: a.sector,
          deal_stage_at_writing: a.deal_stage_at_writing,
          outcome: a.outcome,
          conviction_at_writing: a.conviction_at_writing,
          voice_representativeness: a.voice_representativeness,
          authorship: a.authorship,
          author_initials: a.author_initials,
          focus_attention_on: a.focus_attention_on ?? [],
          deprioritize_in_this_memo: a.deprioritize_in_this_memo ?? [],
          partner_notes: a.partner_notes,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Save failed')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 max-w-4xl">
      <Link href="/settings/memo-agent/style-anchors" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> All anchors
      </Link>

      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{a.title || a.file_name}</h1>
          <div className="text-xs text-muted-foreground mt-1 inline-flex items-center gap-1">
            <FileText className="h-3 w-3" /> {a.file_name} · {a.file_format.toUpperCase()} · {a.file_size_bytes ? `${(a.file_size_bytes / 1024 / 1024).toFixed(1)} MB` : '—'}
          </div>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5 mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          {saved ? 'Saved' : 'Save'}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Identification</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Title">
              <Input value={a.title ?? ''} onChange={e => update('title', e.target.value || null)} />
            </Field>
            <Field label="Anonymized">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={a.anonymized}
                  onChange={e => update('anonymized', e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-xs">Names and figures redacted in this memo</span>
              </label>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Vintage</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Year">
                <Input
                  type="number"
                  value={a.vintage_year ?? ''}
                  onChange={e => update('vintage_year', e.target.value ? parseInt(e.target.value, 10) : null)}
                  placeholder="e.g. 2024"
                />
              </Field>
              <Field label="Quarter">
                <select
                  value={a.vintage_quarter ?? ''}
                  onChange={e => update('vintage_quarter', (e.target.value || null) as Anchor['vintage_quarter'])}
                  className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm"
                >
                  <option value="">—</option>
                  <option value="Q1">Q1</option>
                  <option value="Q2">Q2</option>
                  <option value="Q3">Q3</option>
                  <option value="Q4">Q4</option>
                </select>
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Deal context</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Sector">
              <Input value={a.sector ?? ''} onChange={e => update('sector', e.target.value || null)} placeholder="e.g. B2B SaaS — vertical CRM" />
            </Field>
            <Field label="Stage at writing">
              <select
                value={a.deal_stage_at_writing ?? ''}
                onChange={e => update('deal_stage_at_writing', e.target.value || null)}
                className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm"
              >
                <option value="">—</option>
                <option value="pre_seed">Pre-seed</option>
                <option value="seed">Seed</option>
                <option value="series_a">Series A</option>
                <option value="series_b">Series B</option>
                <option value="growth">Growth</option>
                <option value="follow_on">Follow-on</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Outcome">
              <select
                value={a.outcome ?? ''}
                onChange={e => update('outcome', (e.target.value || null) as Anchor['outcome'])}
                className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm"
              >
                <option value="">—</option>
                <option value="invested">Invested</option>
                <option value="passed">Passed</option>
                <option value="lost_competitive">Lost competitive</option>
                <option value="withdrew">Withdrew</option>
                <option value="unknown">Unknown</option>
              </select>
            </Field>
            <Field label="Conviction at writing">
              <select
                value={a.conviction_at_writing ?? ''}
                onChange={e => update('conviction_at_writing', (e.target.value || null) as Anchor['conviction_at_writing'])}
                className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm"
              >
                <option value="">—</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="mixed">Mixed</option>
              </select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Voice & authorship</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Voice representativeness">
              <select
                value={a.voice_representativeness}
                onChange={e => update('voice_representativeness', e.target.value as Anchor['voice_representativeness'])}
                className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm"
              >
                <option value="exemplary">Exemplary — gold standard</option>
                <option value="representative">Representative — typical voice</option>
                <option value="atypical">Atypical — read with care</option>
                <option value="do_not_match_voice">Do not match — structure only</option>
              </select>
            </Field>
            <Field label="Authorship">
              <select
                value={a.authorship ?? ''}
                onChange={e => update('authorship', e.target.value || null)}
                className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm"
              >
                <option value="">—</option>
                <option value="single_partner">Single partner</option>
                <option value="lead_with_input">Lead with input</option>
                <option value="partnership">Partnership</option>
                <option value="unknown">Unknown</option>
              </select>
            </Field>
            <Field label="Author initials">
              <Input value={a.author_initials ?? ''} onChange={e => update('author_initials', e.target.value || null)} placeholder="e.g. TD" />
            </Field>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-base">Attention</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Focus attention on (comma-separated taxonomy IDs)">
              <Input
                value={(a.focus_attention_on ?? []).join(', ')}
                onChange={e => update('focus_attention_on', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                placeholder="e.g. team_assessment, market_sizing"
              />
            </Field>
            <Field label="Deprioritize in this memo">
              <Input
                value={(a.deprioritize_in_this_memo ?? []).join(', ')}
                onChange={e => update('deprioritize_in_this_memo', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                placeholder="e.g. competitive_landscape (if dated)"
              />
            </Field>
            <p className="text-[11px] text-muted-foreground">
              Use IDs from the <Link href="/settings/memo-agent/schemas/style_anchors" className="underline">style anchors schema</Link>{' '}
              attention_taxonomy. Leave empty to attend to everything equally.
            </p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-base">Partner notes</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <textarea
              value={a.partner_notes ?? ''}
              onChange={e => update('partner_notes', e.target.value || null)}
              rows={4}
              className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Free-text guidance for the agent — e.g. 'Gold standard for team sections', 'Structure is right; voice too formal — match content not tone'"
            />
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-base">Text extraction</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {a.extracted_at ? (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  Text extracted {new Date(a.extracted_at).toLocaleString()} —
                  {a.extracted_text ? ` ${a.extracted_text.length.toLocaleString()} characters` : ' empty'}.
                </p>
                {a.extracted_text && (
                  <pre className="whitespace-pre-wrap rounded border bg-muted/30 p-3 max-h-72 overflow-y-auto text-xs">
                    {a.extracted_text.slice(0, 4000)}
                    {a.extracted_text.length > 4000 && '\n[…truncated]'}
                  </pre>
                )}
              </div>
            ) : (
              <p className="text-amber-600">
                Text extraction failed at upload time. Re-upload the file or contact support if this persists.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {error && <p className="text-sm text-destructive mt-3">{error}</p>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  )
}
