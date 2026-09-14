'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/settings/section'
import { parseSiteContent, SITE_FONT_DEFAULT } from '@/lib/marketing/content'
import { FONT_OPTIONS } from '@/lib/theme'

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

  // The font is one key inside the same JSON, surfaced as a select so it can be
  // changed without knowing the field exists. Writing it back into `text` keeps
  // the textarea the single source of truth for what Save sends.
  const fontKey = (parsed && typeof parsed === 'object' && typeof (parsed as any).font === 'string' && FONT_OPTIONS.some(o => o.key === (parsed as any).font))
    ? (parsed as any).font as string
    : SITE_FONT_DEFAULT
  function setFont(key: string) {
    if (!parsed || typeof parsed !== 'object') return
    setText(JSON.stringify({ ...(parsed as object), font: key }, null, 2))
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
      <div className="mb-3 max-w-xs">
        <label className="text-xs font-medium block mb-1" htmlFor="site-font">Typeface</label>
        <select id="site-font" value={fontKey} onChange={e => setFont(e.target.value)} disabled={loading || !parsed} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
          {FONT_OPTIONS.filter(o => o.key !== 'system').map(o => <option key={o.key} value={o.key}>{o.label}{o.key === SITE_FONT_DEFAULT ? ' (default)' : ''}</option>)}
        </select>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          {FONT_OPTIONS.find(o => o.key === fontKey)?.note ? <span className="text-warning">{FONT_OPTIONS.find(o => o.key === fontKey)?.note} </span> : null}
          Body and headings on the public page only. The app&apos;s own font is set per fund under Appearance.
        </p>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        spellCheck={false}
        disabled={loading}
        className="w-full h-96 font-mono text-xs rounded-card border bg-background p-3"
        placeholder='{ "hero": { "title": "...", "subtitle": "..." }, "productGroups": [ ... ] }'
      />
      {parseError && <p className="text-sm text-warning mt-2">{parseError}</p>}
      {error && <p className="text-sm text-destructive mt-2">{error}</p>}
      <div className="mt-3">
        <Button size="sm" onClick={save} disabled={saving || !!parseError}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}
