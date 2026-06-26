'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Per-stage prompt guidance — voice, depth, and approach the agent applies at
// each stage. Fund-level; persisted via /api/diligence/prompts. Moved here from
// the (removed) /diligence/settings page.
const STAGES = ['ingest', 'research', 'qa', 'draft', 'score'] as const
type Stage = typeof STAGES[number]

const STAGE_META: Record<Stage, { label: string; hint: string; placeholder: string }> = {
  ingest: {
    label: 'Stage 1 — Ingestion',
    hint: 'How documents are read and findings extracted.',
    placeholder: 'e.g. Treat founder LinkedIn-style bios as team_bio. Pull out every revenue or pipeline number even if stated loosely.',
  },
  research: {
    label: 'Stage 2 — Research',
    hint: 'How findings are verified and competitors / founders are researched.',
    placeholder: 'e.g. Prioritise verifying revenue and customer findings. For competitors, focus on the specific wedge, not the broad category.',
  },
  qa: {
    label: 'Stage 3 — Q&A',
    hint: 'How the partner Q&A flow is framed.',
    placeholder: 'e.g. Keep questions short and specific. Ask about team dynamics and founder motivation.',
  },
  draft: {
    label: 'Stage 4 — Memo draft',
    hint: 'How the memo is written — voice, structure, depth, what to emphasise. The highest-leverage guidance.',
    placeholder: 'e.g. Write in a punchy, opinionated voice. Open with the bet in two sentences. Keep it under four pages.',
  },
  score: {
    label: 'Stage 5 — Scoring',
    hint: 'How rubric dimensions are judged.',
    placeholder: 'e.g. Weight team and market more heavily than current traction at the pre-seed stage.',
  },
}

export function MemoGuidanceEditor() {
  const [guidance, setGuidance] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/diligence/prompts')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then(b => { setGuidance(b.guidance ?? {}); setLoaded(true) })
      .catch(() => { setError('Failed to load guidance.'); setLoaded(true) })
  }, [])

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/diligence/prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guidance }),
      })
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? 'Save failed') }
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return <div className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>

  return (
    <div className="space-y-3">
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{error}</div>}
      {STAGES.map(stage => (
        <div key={stage} className="rounded-md border p-3 space-y-2">
          <div className="text-sm font-medium">{STAGE_META[stage].label}</div>
          <p className="text-xs text-muted-foreground">{STAGE_META[stage].hint}</p>
          <textarea
            value={guidance[stage] ?? ''}
            onChange={e => setGuidance(prev => ({ ...prev, [stage]: e.target.value }))}
            rows={stage === 'draft' ? 7 : 4}
            placeholder={STAGE_META[stage].placeholder}
            className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      ))}
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : saved ? <Check className="h-4 w-4 mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          {saved ? 'Saved' : 'Save guidance'}
        </Button>
      </div>
    </div>
  )
}
