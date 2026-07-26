'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ACCENT_PRESETS, FONT_OPTIONS, DISPLAY_FONT_OPTIONS, RADIUS_OPTIONS, themeCssVars, hexToHsl, hslToHex, type FundTheme } from '@/lib/theme'

// Branding / appearance editor. Previews live across the whole app (injects a
// <style> override into <head>) and saves the fund-wide theme. The default is
// neutral gray + system font; everything here is an opt-in override.
export function AppearanceEditor() {
  const [accent, setAccent] = useState<string | null>(null)
  const [font, setFont] = useState<string>('system')
  const [displayFont, setDisplayFont] = useState<string>('newsreader')
  const [radius, setRadius] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/theme')
      .then(r => (r.ok ? r.json() : null))
      .then(b => {
        const t: FundTheme | null = b?.theme ?? null
        setAccent(t?.accent ?? null)
        setFont(t?.font ?? 'system')
        setDisplayFont(t?.displayFont ?? 'newsreader')
        setRadius(typeof t?.radius === 'number' ? t.radius : null)
      })
      .finally(() => setLoaded(true))
  }, [])

  const draft: FundTheme = {
    accent,
    font: font === 'system' ? null : font,
    displayFont: displayFont === 'newsreader' ? null : displayFont,
    radius: radius ?? undefined,
  }
  const isCustom = !!accent && !ACCENT_PRESETS.some(p => p.hsl === accent)

  // Live, app-wide preview while editing.
  useEffect(() => {
    if (!loaded) return
    const id = 'appearance-preview'
    let el = document.getElementById(id) as HTMLStyleElement | null
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el) }
    const vars = themeCssVars(draft)
    el.textContent = vars ? `:root{${vars}}` : ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, accent, font, displayFont, radius])
  // Drop the preview when leaving the page; the server-rendered theme takes over.
  useEffect(() => () => { document.getElementById('appearance-preview')?.remove() }, [])

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/settings/theme', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: draft }),
      })
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? 'Save failed') }
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }
  function reset() { setAccent(null); setFont('system'); setDisplayFont('newsreader'); setRadius(null) }

  if (!loaded) return <div className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 inline animate-spin mr-2" />Loading…</div>

  return (
    <div className="space-y-5">
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{error}</div>}
      <p className="text-xs text-muted-foreground max-w-xl">
        Changes preview live across the app. Save to apply for everyone in your fund. The defaults are a neutral accent, Inter for the interface and Newsreader for reports; everything here is optional.
      </p>

      <div>
        <div className="text-xs font-medium mb-2">Accent color</div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setAccent(null)} className={`h-8 px-3 rounded-md border text-xs ${accent === null ? 'border-foreground bg-muted font-medium' : 'hover:bg-muted/50'}`}>Default</button>
          {ACCENT_PRESETS.filter(p => p.key !== 'neutral').map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => setAccent(p.hsl)}
              title={p.label}
              aria-label={p.label}
              className={`h-8 w-8 rounded-md border flex items-center justify-center ${accent === p.hsl ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground' : ''}`}
              style={{ backgroundColor: `hsl(${p.hsl})` }}
            >
              {accent === p.hsl && <Check className="h-4 w-4" style={{ color: `hsl(${p.fg})` }} />}
            </button>
          ))}
          {/* Custom brand color */}
          <div className={`flex items-center gap-1.5 rounded-md border pl-1.5 pr-2 h-8 ${isCustom ? 'border-foreground bg-muted' : ''}`}>
            <input
              type="color"
              aria-label="Custom accent color"
              title="Custom brand color"
              value={accent ? (hslToHex(accent) ?? '#4f46e5') : '#4f46e5'}
              onChange={e => { const h = hexToHsl(e.target.value); if (h) setAccent(h) }}
              className="h-5 w-5 rounded cursor-pointer bg-transparent border-0 p-0"
            />
            <span className="text-xs text-muted-foreground">Custom</span>
          </div>
        </div>
        {isCustom && <p className="text-[10px] text-muted-foreground mt-1.5">Custom <span className="font-mono">{hslToHex(accent!)}</span>. Button-text contrast is set automatically.</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
        <div>
          <div className="text-xs font-medium mb-1">UI font</div>
          <select value={font} onChange={e => setFont(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            {FONT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <p className="text-[10px] text-muted-foreground mt-1">Body text, tables and controls.</p>
        </div>
        <div>
          <div className="text-xs font-medium mb-1">Report font</div>
          <select value={displayFont} onChange={e => setDisplayFont(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            {DISPLAY_FONT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <p className="text-[10px] text-muted-foreground mt-1">
            {DISPLAY_FONT_OPTIONS.find(o => o.key === displayFont)?.note} Headings on report covers, letters and statements — including PDFs. Word exports use a system font and are unaffected.
          </p>
        </div>
        <div>
          <div className="text-xs font-medium mb-1">Corner radius</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setRadius(null)} className={`h-9 px-3 rounded-md border text-xs ${radius === null ? 'border-foreground bg-muted font-medium' : 'hover:bg-muted/50'}`}>Default</button>
            {RADIUS_OPTIONS.map(o => (
              <button key={o.key} type="button" onClick={() => setRadius(o.rem)} className={`h-9 px-3 rounded-md border text-xs ${radius === o.rem ? 'border-foreground bg-muted font-medium' : 'hover:bg-muted/50'}`}>{o.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-card border p-5 space-y-4 max-w-xl">
        <div className="text-xs font-medium text-muted-foreground">Preview</div>
        <div>
          <p className="text-eyebrow uppercase text-muted-foreground mb-2">Q3 2026</p>
          <p className="font-display text-heading font-normal">Quarterly Report to Limited Partners</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Primary action</Button>
          <Button size="sm" variant="outline">Secondary</Button>
          <span className="text-sm">Body text with a <a href="#" onClick={e => e.preventDefault()} className="text-primary underline">link</a> and <span className="tabular-nums">$1,234.56</span>.</span>
        </div>
      </div>

      <div className="flex justify-end gap-2 max-w-xl">
        <Button variant="ghost" size="sm" onClick={reset}>Reset to default</Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5 mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          {saved ? 'Saved' : 'Save appearance'}
        </Button>
      </div>
    </div>
  )
}
