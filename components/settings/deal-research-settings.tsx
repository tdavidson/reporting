'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/settings/section'

/**
 * Whether inbound deals get a round of external web research, and how
 * interesting a deal has to be to earn one.
 *
 * The bar exists because this costs money per deal and a VC inbox is mostly
 * noise. Researching every cold pitch would spend the budget on recruiter spam.
 *
 * Rendered as a <Section>, not a bare <Card>, so it carries the admin chrome (amber
 * border + lock) of the block it sits in. It is admin-only in every other respect —
 * fund_settings column, and /api/settings/deal-research 403s a non-admin on both GET
 * and PUT — and looking like an ordinary member-editable card was the odd one out.
 */

type MinFit = 'strong' | 'moderate' | 'weak'

const FIT_LABELS: Record<MinFit, string> = {
  strong: 'Strong fit only — the most selective, cheapest option',
  moderate: 'Moderate and strong fit (recommended)',
  weak: 'Weak fit and above — researches almost everything that isn\'t spam',
}

export function DealResearchSettings() {
  const [enabled, setEnabled] = useState(false)
  const [minFit, setMinFit] = useState<MinFit>('moderate')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings/deal-research')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setEnabled(!!d.enabled)
          setMinFit((d.min_fit ?? 'moderate') as MinFit)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/deal-research', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, min_fit: minFit }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Could not save')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <Section title="External deal research">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          After an inbound deal is scored against your thesis, research the founder and company on
          the web: prior companies, whether their traction claims show up anywhere outside the deck,
          the competitive picture, and anything that contradicts the pitch.
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
          />
          Research qualifying inbound deals automatically
        </label>

        <div className="space-y-1">
          <label className="text-sm font-medium">Only research deals scoring at least</label>
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
            value={minFit}
            disabled={!enabled}
            onChange={e => setMinFit(e.target.value as MinFit)}
          >
            {(['strong', 'moderate', 'weak'] as MinFit[]).map(f => (
              <option key={f} value={f}>{FIT_LABELS[f]}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Each research run costs a handful of web searches on top of tokens. Most of an inbound
            VC mailbox is noise, so the bar keeps that spend on deals you might actually take.
            You can always run research by hand on an individual deal, whatever it scored.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Requires Anthropic as the deal-analysis provider — web search is not available on the
          other providers, and researching without it would mean answering from stale training data.
        </p>

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
          {saved && <span className="text-xs text-success">Saved</span>}
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      </div>
    </Section>
  )
}
