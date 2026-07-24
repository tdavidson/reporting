'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/settings/section'
import { parseSiteContent } from '@/lib/marketing/content'

export function MarketingSection() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/site-content')
      .then(r => (r.ok ? r.json() : { content: null }))
      .then(d => setText(d.content ? JSON.stringify(d.content, null, 2) : ''))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Validate on every edit so Save is only enabled for renderable content.
  let parsed: unknown = null
  let parseError: string | null = null
  if (text.trim()) {
    try {
      parsed = JSON.parse(text)
      if (parseSiteContent(parsed) === null) parseError = 'Valid JSON, but missing a hero (title+subtitle) or a product group with a feature.'
    } catch (e) {
      parseError = `Invalid JSON: ${(e as Error).message}`
    }
  } else {
    parseError = 'Empty — the marketing page will redirect to sign-in until content is added.'
  }

  async function save() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/settings/site-content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: parsed }),
      })
      if (!res.ok) { setError((await res.json().catch(() => ({})))?.error || 'Save failed'); return }
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Marketing site">
      <p className="text-sm text-muted-foreground mb-3">
        JSON for the public one-page marketing site. Leave empty to keep the page off (it redirects
        to sign-in). Screenshots reference files in <code>/public/screenshots</code>.
      </p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        spellCheck={false}
        disabled={loading}
        className="w-full h-96 font-mono text-xs rounded-md border bg-background p-3"
        placeholder='{ "hero": { "title": "...", "subtitle": "..." }, "productGroups": [ ... ] }'
      />
      {parseError && <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{parseError}</p>}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      <div className="mt-3">
        <Button size="sm" onClick={save} disabled={saving || !!parseError}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}
