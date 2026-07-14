'use client'

// A vehicle's carry terms — what the close accrues carried interest on.
//
// Rates are entered as PERCENTAGES here and stored as fractions. Nobody thinks in 0.2; they
// think in 20%. The conversion happens at this boundary and nowhere else.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLedgerFetch } from '@/components/accounting-vehicle'

type Kind = 'none' | 'straight' | 'european'

interface Candidate { lpEntityId: string; name: string; partnerClass: string }

interface Terms {
  kind: Kind
  carryRate: number
  prefRate: number
  catchupRate: number
  prefCompounds: boolean
  gpEntityId: string | null
}

const pct = (fraction: number) => (fraction ? String(Math.round(fraction * 10000) / 100) : '')
const frac = (percent: string) => {
  const n = Number(percent)
  return Number.isFinite(n) ? n / 100 : 0
}

export function CarryTerms() {
  const lf = useLedgerFetch()

  const [kind, setKind] = useState<Kind>('none')
  const [carry, setCarry] = useState('')
  const [pref, setPref] = useState('')
  const [catchup, setCatchup] = useState('100')
  const [compounds, setCompounds] = useState(true)
  const [gpEntityId, setGpEntityId] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await lf('/api/accounting/waterfall-terms')
    if (res.ok) {
      const d = await res.json()
      const t: Terms = d.terms
      setKind(t.kind)
      setCarry(pct(t.carryRate))
      setPref(pct(t.prefRate))
      setCatchup(pct(t.catchupRate) || '100')
      setCompounds(t.prefCompounds)
      setGpEntityId(t.gpEntityId ?? '')
      setCandidates(d.candidates ?? [])
    }
    setLoading(false)
  }, [lf])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setBusy(true); setError(null); setSaved(false)
    const res = await lf('/api/accounting/waterfall-terms', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        carryRate: frac(carry),
        prefRate: frac(pref),
        catchupRate: frac(catchup),
        prefCompounds: compounds,
        gpEntityId: gpEntityId || null,
      }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? 'Could not save'); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (loading) {
    return <div className="border rounded-lg p-4 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />Loading carry terms…
    </div>
  }

  const carryOn = kind !== 'none'

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <p className="text-sm font-medium">Carried interest</p>
      <p className="text-xs text-muted-foreground max-w-3xl">
        The close accrues carry on <strong>unrealized</strong> gains, as if the fund liquidated at
        that period&rsquo;s NAV. Without it every LP&rsquo;s reported NAV overstates what they would
        actually receive by the GP&rsquo;s share of the gain. It reverses on its own if NAV falls.
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        {([
          ['none', 'No carry'],
          ['straight', 'Straight split'],
          ['european', 'European (pref + catch-up)'],
        ] as [Kind, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`text-xs rounded-md border px-3 py-1.5 ${
              kind === k ? 'bg-foreground text-background border-foreground' : 'hover:bg-accent text-muted-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === 'none' && (
        <p className="text-xs text-muted-foreground">
          Nothing is accrued. This is the default &mdash; accruing carry nobody agreed to is worse
          than accruing none.
        </p>
      )}

      {carryOn && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Carry" hint="GP's share of profit">
              <Suffix suffix="%">
                <Input value={carry} onChange={e => setCarry(e.target.value)} placeholder="20" />
              </Suffix>
            </Field>

            {kind === 'european' && (
              <>
                <Field label="Preferred return" hint="Annual hurdle">
                  <Suffix suffix="%">
                    <Input value={pref} onChange={e => setPref(e.target.value)} placeholder="8" />
                  </Suffix>
                </Field>
                <Field label="Catch-up" hint="100% = full catch-up">
                  <Suffix suffix="%">
                    <Input value={catchup} onChange={e => setCatchup(e.target.value)} placeholder="100" />
                  </Suffix>
                </Field>
              </>
            )}

            <Field label="Carry accrues to" hint="Which partner receives it">
              <select
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={gpEntityId}
                onChange={e => setGpEntityId(e.target.value)}
              >
                <option value="">Select…</option>
                {candidates.map(c => (
                  <option key={c.lpEntityId} value={c.lpEntityId}>
                    {c.name}{c.partnerClass === 'gp' ? ' (GP)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {kind === 'european' && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={compounds} onChange={e => setCompounds(e.target.checked)} />
              The preferred return compounds annually
            </label>
          )}

          {/* The carry has to land in a real partner's capital account, or it belongs to nobody
              — it never shows in any capital account, and the associates look-through can't
              split it. Say so before they hit Save and get a 400. */}
          {!gpEntityId && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              Choose the partner who receives the carry — otherwise the close has nowhere to post it.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Each partner&rsquo;s <strong>carry points</strong> can differ from their capital: set a
            weight override on the <em>Carried interest</em> column below. A partner may hold carry
            points with no commitment at all.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-amber-600">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
          Save carry terms
        </Button>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Suffix({ suffix, children }: { suffix: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
    </div>
  )
}
