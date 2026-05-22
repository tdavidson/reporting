'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const STAGES = ['ingest', 'research', 'qa', 'draft', 'score'] as const
type Stage = typeof STAGES[number]

const STAGE_META: Record<Stage, { label: string; hint: string; placeholder: string }> = {
  ingest: {
    label: 'Stage 1 — Ingestion',
    hint: 'How documents are read and claims extracted. Guidance here shapes what the agent treats as a claim and how it classifies documents.',
    placeholder: 'e.g. Treat founder LinkedIn-style bios as team_bio. Pull out every revenue or pipeline number even if stated loosely.',
  },
  research: {
    label: 'Stage 2 — Research',
    hint: 'How claims are verified and competitors / founders are researched.',
    placeholder: 'e.g. Prioritise verifying revenue and customer claims. For competitors, focus on the specific wedge, not the broad category.',
  },
  qa: {
    label: 'Stage 3 — Q&A',
    hint: 'How the partner Q&A flow is framed.',
    placeholder: 'e.g. Keep questions short and specific. Ask about team dynamics and founder motivation.',
  },
  draft: {
    label: 'Stage 4 — Memo draft',
    hint: 'How the memo is written — voice, structure, depth, what to emphasise. This is the highest-leverage guidance.',
    placeholder: 'e.g. Write in a punchy, opinionated voice. Open with the bet in two sentences. Be willing to take a clear view. Keep it under four pages.',
  },
  score: {
    label: 'Stage 5 — Scoring',
    hint: 'How rubric dimensions are judged.',
    placeholder: 'e.g. Weight team and market more heavily than current traction at the pre-seed stage.',
  },
}

export function DiligenceSettingsEditor() {
  const [guidance, setGuidance] = useState<Record<string, string>>({})
  const [anchors, setAnchors] = useState<Array<{ id: string; label: string }>>([])
  const [firstPageAnchorId, setFirstPageAnchorId] = useState<string>('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/diligence/prompts')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load')))
      .then(body => {
        setGuidance(body.guidance ?? {})
        setAnchors(Array.isArray(body.anchors) ? body.anchors : [])
        setFirstPageAnchorId(body.first_page_anchor_id ?? '')
        setLoaded(true)
      })
      .catch(() => { setError('Failed to load settings.'); setLoaded(true) })
  }, [])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/diligence/prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guidance, first_page_anchor_id: firstPageAnchorId || null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Save failed')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return <div className="p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
  }

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 max-w-4xl">
      <Link href="/diligence" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to diligence
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight mb-1">Diligence Settings</h1>
      <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
        Per-stage guidance for the memo agent. This text is injected into each stage&apos;s
        prompt — use it to tune voice, depth, and approach without touching code. Leave a
        stage blank to use the shipped default. Open to all partners.
      </p>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive mb-4">{error}</div>}

      <div className="space-y-4">
        {STAGES.map(stage => (
          <Card key={stage}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{STAGE_META[stage].label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">{STAGE_META[stage].hint}</p>
              <textarea
                value={guidance[stage] ?? ''}
                onChange={e => setGuidance(prev => ({ ...prev, [stage]: e.target.value }))}
                rows={stage === 'draft' ? 7 : 4}
                placeholder={STAGE_META[stage].placeholder}
                className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Memo first-page template</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Pick a sample memo whose first page the agent should model new memos on — title block,
              framing, and opening. The memo&apos;s section structure is taken from the schema (editable
              below); the agent also mirrors your sample memos&apos; structure.
            </p>
            {anchors.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No sample memos uploaded yet. Add them under Style anchors below.
              </p>
            ) : (
              <select
                value={firstPageAnchorId}
                onChange={e => setFirstPageAnchorId(e.target.value)}
                className="h-9 px-2 rounded-md border border-input bg-background text-sm w-full max-w-md"
              >
                <option value="">— no first-page exemplar —</option>
                {anchors.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">More settings</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1.5">
            <Link href="/settings/memo-agent/defaults" className="block text-primary hover:underline">Models, cost caps, export formatting, web search →</Link>
            <Link href="/settings/memo-agent/schemas" className="block text-primary hover:underline">Schemas (rubric, memo structure, document types) →</Link>
            <Link href="/settings/memo-agent/style-anchors" className="block text-primary hover:underline">Style anchors (voice from sample memos) →</Link>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : saved ? <Check className="h-4 w-4 mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {saved ? 'Saved' : 'Save guidance'}
          </Button>
        </div>
      </div>
    </div>
  )
}
