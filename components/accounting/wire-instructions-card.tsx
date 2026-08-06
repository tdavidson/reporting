'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLedgerFetch } from '@/components/accounting-vehicle'

/**
 * Bank details printed on this vehicle's capital call notices.
 *
 * Per vehicle, not per call: an SPV's account is a standing fact, and re-typing it into every
 * call is how one notice goes out with a stale account number. A notice generated without
 * these still renders — it says payment instructions will follow separately, rather than
 * looking complete while telling nobody where to send the money.
 */
export function WireInstructionsCard() {
  const lf = useLedgerFetch()
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    lf('/api/accounting/vehicle-settings')
      .then(r => (r.ok ? r.json() : { wireInstructions: '' }))
      .then(d => setValue(d.wireInstructions ?? ''))
      .finally(() => setLoading(false))
  }, [lf])
  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true); setErr(null); setSaved(false)
    const res = await lf('/api/accounting/vehicle-settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wireInstructions: value }),
    })
    setSaving(false)
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? 'Could not save'); return }
    setSaved(true)
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  }

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={e => { setValue(e.target.value); setSaved(false) }}
        rows={6}
        placeholder={'Bank name\nAccount name\nAccount number / IBAN\nRouting / SWIFT\nReference'}
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save
        </Button>
        {saved && <span className="flex items-center gap-1 text-xs text-success"><Check className="h-3.5 w-3.5" />Saved</span>}
        {err && <span className="text-sm text-warning">{err}</span>}
        <span className="text-xs text-muted-foreground">Printed verbatim on capital call notices for this vehicle.</span>
      </div>
    </div>
  )
}
