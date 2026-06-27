'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Editable fund-level guidance for a single agent stage. Reads/writes the same
 * memo_agent_prompts store as Settings → Memo agent → Per-stage guidance, so it
 * stays in sync — but surfaced inline in the deal's "How the agent works"
 * sections so partners can tune it where they work. Applies to all deals.
 */
export function StageGuidance({ stage }: { stage: string }) {
  const [value, setValue] = useState('')
  const [initial, setInitial] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/diligence/prompts')
      .then(r => (r.ok ? r.json() : null))
      .then(b => {
        if (cancelled) return
        const g = (b?.guidance?.[stage] as string) ?? ''
        setValue(g); setInitial(g)
      })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [stage])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/diligence/prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guidance: { [stage]: value } }),
      })
      if (res.ok) { setInitial(value); setSaved(true); setTimeout(() => setSaved(false), 2000) }
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return <div className="text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" /> Loading guidance…</div>

  const dirty = value !== initial
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Your guidance for this analysis, additive to the base prompt.</span>
      </div>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        rows={4}
        placeholder="Tune voice, depth, and what to emphasise at this stage. Leave blank for the shipped defaults."
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="h-7" onClick={save} disabled={!dirty || saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5 mr-1" /> : null}
          {saved ? 'Saved' : 'Save guidance'}
        </Button>
      </div>
    </div>
  )
}
