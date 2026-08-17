'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCurrency, formatCurrency } from '@/components/currency-context'
import { FofValuationNote, type ValuationBasisRow } from '@/components/accounting/fof-valuation-note'

interface Position {
  companyId: string
  name: string
  commitment: number
  contributed: number
  distributed: number
  unfunded: number
  carryingValue: number
  reportedNav: number | null
  navAsOf: string | null
  stalenessDays: number | null
}

interface TieOutRow {
  name: string
  field: 'contributions' | 'distributions' | 'unfunded'
  ours: number
  theirs: number
  difference: number
}

interface PendingMark {
  companyId: string
  name: string
  derivedCarrying: number
  ledgerCarrying: number
  delta: number
}

interface PreviewRow {
  companyId: string; matchedName: string; fundName: string
  calls: number; distributions: number; reportedNav: number | null; navAsOf: string | null
  /** Extraction only — absent for a paste. */
  confidence?: 'high' | 'medium' | 'low'
  sourceText?: string | null
}

interface PastePreview {
  matched: PreviewRow[]
  unmatched: string[]
  errors: string[]
  /** Set when the rows came from a document rather than a paste. */
  extracted?: boolean
  note?: string
}

const STALE_DAYS = 100

export function FofQuarterView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrency(v, currency)

  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [positions, setPositions] = useState<Position[]>([])
  const [tieOut, setTieOut] = useState<TieOutRow[]>([])
  const [marks, setMarks] = useState<PendingMark[]>([])
  const [valuationNote, setValuationNote] = useState<ValuationBasisRow[]>([])
  const [pasteText, setPasteText] = useState('')
  const [preview, setPreview] = useState<PastePreview | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [gridRes, marksRes] = await Promise.all([
        fetch(`/api/accounting/fof-grid?asOf=${asOf}`),
        fetch(`/api/accounting/fof-marks?asOf=${asOf}`),
      ])
      const grid = await gridRes.json()
      const mk = await marksRes.json()
      setPositions(grid?.positions ?? [])
      setTieOut(grid?.tieOut ?? [])
      setMarks(mk?.marks ?? [])
      setValuationNote(mk?.valuationNote ?? [])
    } finally {
      setLoading(false)
    }
  }, [asOf])

  useEffect(() => { void load() }, [load])

  async function runPreview() {
    setBusy(true); setStatus(null)
    try {
      const res = await fetch('/api/accounting/fof-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText, periodEnd: asOf }),
      })
      const json = await res.json()
      if (!res.ok) { setStatus(json?.error ?? 'Could not read that paste.'); return }
      setPreview(json)
    } finally { setBusy(false) }
  }

  /**
   * Read a manager document into the SAME preview the paste path produces. Extraction writes
   * nothing — applying goes through the one grid endpoint either way.
   */
  async function extractFile(file: File) {
    setExtracting(true); setStatus(null); setPreview(null)
    try {
      const buf = await file.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const res = await fetch('/api/accounting/fof-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: btoa(binary),
          mediaType: file.type || 'application/pdf',
          fileName: file.name,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setStatus(json?.error ?? 'Could not read that document.'); return }
      setPreview({
        matched: json.matched ?? [],
        unmatched: json.unmatched ?? [],
        errors: json.warnings ?? [],
        extracted: true,
        note: json.note,
      })
    } finally { setExtracting(false) }
  }

  async function applyPaste() {
    setBusy(true); setStatus(null)
    try {
      const res = await fetch('/api/accounting/fof-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          preview?.extracted
            ? { rows: preview.matched, periodEnd: asOf, apply: true }
            : { text: pasteText, periodEnd: asOf, apply: true },
        ),
      })
      const json = await res.json()
      if (!res.ok) { setStatus(json?.error ?? 'Could not apply.'); return }
      setStatus(`Recorded ${json.eventsCreated} notice(s) and ${json.navStatements} NAV statement(s) as drafts.`)
      setPreview(null); setPasteText('')
      await load()
    } finally { setBusy(false) }
  }

  async function confirmAll() {
    setBusy(true); setStatus(null)
    try {
      const res = await fetch('/api/accounting/fof-grid/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodEnd: asOf }),
      })
      const json = await res.json()
      const bits = [`${json.confirmed} confirmed`]
      if (json.skipped) bits.push(`${json.skipped} recorded but not posted (before the ledger start date)`)
      if (json.errors?.length) bits.push(`${json.errors.length} failed`)
      setStatus(bits.join(', ') + '.')
      await load()
    } finally { setBusy(false) }
  }

  async function bookMarks() {
    setBusy(true); setStatus(null)
    try {
      const res = await fetch('/api/accounting/fof-marks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asOf }),
      })
      const json = await res.json()
      setStatus(`Booked ${json.booked} of ${json.total} period-end mark(s) as draft entries.`)
      await load()
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Quarterly close — underlying funds</h1>
        <p className="text-sm text-muted-foreground">
          Paste the quarter&rsquo;s figures, confirm the notices, then book the period-end marks.
        </p>
        <div className="flex items-center gap-2 pt-3">
          <span className="text-sm text-muted-foreground">Period end</span>
          <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}
                 className="border rounded-lg px-2 py-1 text-sm" />
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={confirmAll} disabled={busy}>Confirm all drafts</Button>
            <Button size="sm" onClick={bookMarks} disabled={busy || marks.length === 0}>
              Book {marks.length} mark{marks.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
        {status && <p className="text-sm text-warning pt-2">{status}</p>}
      </div>

      <Card className="rounded-card">
        <CardContent className="p-4 space-y-3">
          <h2 className="text-base font-medium">Paste this quarter&rsquo;s figures</h2>
          <p className="text-sm text-muted-foreground">
            One row per fund, with columns for the fund name, NAV as of, reported NAV, calls and
            distributions. A pasted distribution is recorded as pure return of capital until its
            character split is set, which understates realized gain.
          </p>
          <Textarea
            rows={6}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder={'Fund\tNAV as of\tReported NAV\tCalls\tDistributions'}
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={runPreview} disabled={busy || !pasteText.trim()}>
              Check
            </Button>
            <label className="text-sm">
              <span className="sr-only">Upload a manager statement</span>
              <input
                type="file"
                accept=".pdf,.csv,.xlsx,.txt"
                disabled={busy || extracting}
                onChange={e => { const f = e.target.files?.[0]; if (f) void extractFile(f); e.target.value = '' }}
                className="text-sm file:mr-2 file:rounded-lg file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-sm"
              />
            </label>
            {extracting && <span className="text-sm text-muted-foreground flex items-center gap-1"><Loader2 className="h-4 w-4 animate-spin" />Reading the statement…</span>}
            {preview && preview.matched.length > 0 && (
              <Button size="sm" onClick={applyPaste} disabled={busy}>
                Record {preview.matched.length} row{preview.matched.length === 1 ? '' : 's'} as drafts
              </Button>
            )}
          </div>

          {preview && (
            <div className="space-y-2 pt-2">
              <p className="text-sm">
                <CheckCircle2 className="inline h-4 w-4 mr-1 text-success" />
                {preview.matched.length} row{preview.matched.length === 1 ? '' : 's'} matched
                {preview.extracted ? ' from the document' : ''}.
              </p>
              {preview.note && <p className="text-sm text-warning">{preview.note}</p>}
              {preview.extracted && preview.matched.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fund</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">Distributions</TableHead>
                      <TableHead className="text-right">Reported NAV</TableHead>
                      <TableHead>As of</TableHead>
                      <TableHead>Read from</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.matched.map((r, i) => (
                      <TableRow key={`${r.companyId}-${i}`}>
                        <TableCell className="font-medium">
                          {r.matchedName}
                          {/* Low confidence is the model's own flag — check this one against
                              the statement before applying. */}
                          {r.confidence && r.confidence !== 'high' && (
                            <span className="block text-sm text-warning">{r.confidence} confidence</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(r.calls)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(r.distributions)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.reportedNav === null ? '—' : fmt(r.reportedNav)}
                        </TableCell>
                        <TableCell className="tabular-nums">{r.navAsOf ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.sourceText ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {preview.unmatched.length > 0 && (
                <div className="text-sm text-warning">
                  <AlertTriangle className="inline h-4 w-4 mr-1" />
                  Not recognized, and not recorded: {preview.unmatched.join(', ')}. Add the fund
                  first, or add the name as an alias on the existing holding.
                </div>
              )}
              {preview.errors.length > 0 && (
                <ul className="text-sm text-destructive list-disc pl-5">
                  {preview.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {marks.length > 0 && (
        <Card className="rounded-card border-warning">
          <CardContent className="p-4 space-y-2">
            <h2 className="text-base font-medium">Period-end marks not yet booked</h2>
            <p className="text-sm text-muted-foreground">
              The close is blocked until these are booked — the ledger is the control total for
              the schedule of investments, so closing without them would publish a NAV no posting
              supports.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fund</TableHead>
                  <TableHead className="text-right">Ledger carries</TableHead>
                  <TableHead className="text-right">Position values at</TableHead>
                  <TableHead className="text-right">Mark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {marks.map(m => (
                  <TableRow key={m.companyId}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(m.ledgerCarrying)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(m.derivedCarrying)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(m.delta)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-card">
        <CardContent className="p-4 space-y-2">
          <h2 className="text-base font-medium">Manager tie-out</h2>
          {tieOut.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <CheckCircle2 className="inline h-4 w-4 mr-1 text-success" />
              Every position ties to its manager statement.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Where our register disagrees with the manager&rsquo;s own since-inception figures. A
                gap on contributions is usually a call notice that never reached us.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fund</TableHead>
                    <TableHead>Figure</TableHead>
                    <TableHead className="text-right">Ours</TableHead>
                    <TableHead className="text-right">Theirs</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tieOut.map((r, i) => (
                    <TableRow key={`${r.name}-${r.field}-${i}`}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="capitalize">{r.field}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.ours)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.theirs)}</TableCell>
                      <TableCell className="text-right tabular-nums text-warning">{fmt(r.difference)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-card">
        <CardContent className="p-4">
          {loading ? (
            <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : positions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fund holdings yet.</p>
          ) : (
            <div className="space-y-2">
              <h2 className="text-base font-medium">Positions at {asOf}</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fund</TableHead>
                    <TableHead className="text-right">Called</TableHead>
                    <TableHead className="text-right">Unfunded</TableHead>
                    <TableHead className="text-right">Distributed</TableHead>
                    <TableHead className="text-right">Reported NAV</TableHead>
                    <TableHead>As of</TableHead>
                    <TableHead className="text-right">Carrying value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map(p => (
                    <TableRow key={p.companyId}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(p.contributed)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(p.unfunded)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(p.distributed)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.reportedNav === null ? '—' : fmt(p.reportedNav)}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {p.navAsOf ?? <span className="text-muted-foreground">None</span>}
                        {p.stalenessDays !== null && p.stalenessDays > STALE_DAYS && (
                          <span className="block text-warning">{p.stalenessDays}d stale</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(p.carryingValue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-card">
        <CardContent className="p-4">
          <FofValuationNote rows={valuationNote} />
        </CardContent>
      </Card>
    </div>
  )
}
