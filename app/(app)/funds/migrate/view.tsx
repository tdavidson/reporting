'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCurrency, formatCurrency } from '@/components/currency-context'
import { useVehicle } from '@/components/accounting-vehicle'

interface Proposal {
  qbAccount: string
  code: string | null
  confidence: 'exact' | 'likely' | 'none'
  reason: string
  suggestsHolding: string | null
  excluded?: boolean
}

interface ParseResult {
  group: string
  transactionCount: number
  dateRange: { first: string; last: string } | null
  accounts: Proposal[]
  mappedCount: number
  excludedCount: number
  discoveredHoldings: string[]
  errors: string[]
}

interface TieOutResult {
  asOf: string
  ties: boolean
  lines: { code: string; name: string; ours: number; theirs: number; difference: number }[]
  ourTotal: number
  theirTotal: number
  includesDrafts: boolean
  unmappedAccounts: string[]
}

/**
 * The four-step QuickBooks migration, in order, each step gating the next. The order is what
 * makes the migration safe — mapping before import, import before tie-out, tie-out before the
 * cut-over date is set — so the UI exists partly to make it hard to do out of sequence.
 */
export function MigrateView() {
  const currency = useCurrency()
  const { group } = useVehicle()
  const fmt = (v: number) => formatCurrency(v, currency)

  const [journalText, setJournalText] = useState('')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [chart, setChart] = useState<{ code: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const [dryRun, setDryRun] = useState<any>(null)
  const [runs, setRuns] = useState<any[]>([])

  const [tbText, setTbText] = useState('')
  const [tbAsOf, setTbAsOf] = useState('')
  const [tieOut, setTieOut] = useState<TieOutResult | null>(null)

  const loadChart = useCallback(async () => {
    const res = await fetch(`/api/accounting/chart${group ? `?group=${encodeURIComponent(group)}` : ''}`)
    // /api/accounting/chart returns a bare array, not { accounts: [...] }.
    const json = await res.json().catch(() => [])
    const rows = Array.isArray(json) ? json : (json?.accounts ?? [])
    setChart(rows.map((a: any) => ({ code: a.code, name: a.name })))
  }, [group])

  const loadRuns = useCallback(async () => {
    const res = await fetch(`/api/accounting/quickbooks/import${group ? `?group=${encodeURIComponent(group)}` : ''}`)
    const json = await res.json().catch(() => ({}))
    setRuns(json?.runs ?? [])
  }, [group])

  useEffect(() => { void loadChart(); void loadRuns() }, [loadChart, loadRuns])

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group, ...(body as object) }),
    })
    return { ok: res.ok, json: await res.json().catch(() => ({})) }
  }

  async function runParse() {
    setBusy(true); setStatus(null)
    try {
      const { ok, json } = await post('/api/accounting/quickbooks/parse', { text: journalText })
      if (!ok) { setStatus(json?.error ?? 'Could not parse.'); return }
      setParsed(json)
      setMapping(Object.fromEntries(json.accounts.map((a: Proposal) => [a.qbAccount, a.code ?? ''])))
    } finally { setBusy(false) }
  }

  async function saveMapping() {
    setBusy(true); setStatus(null)
    try {
      const rows = Object.entries(mapping).map(([qbAccount, accountCode]) => ({
        qbAccount, accountCode: accountCode || null, excluded: !accountCode,
      }))
      const res = await fetch('/api/accounting/quickbooks/mapping', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group, rows }),
      })
      const json = await res.json()
      setStatus(res.ok ? `Saved ${json.saved} mapping(s).` : (json?.error ?? 'Could not save.'))
    } finally { setBusy(false) }
  }

  async function discoverHoldings() {
    if (!parsed) return
    setBusy(true); setStatus(null)
    try {
      const { ok, json } = await post('/api/accounting/quickbooks/mapping/discover', {
        holdings: parsed.discoveredHoldings,
      })
      if (!ok) { setStatus(json?.error ?? 'Could not create holdings.'); return }
      const bits = [`${json.created.length} created`]
      if (json.existing.length) bits.push(`${json.existing.length} already existed`)
      if (json.errors.length) bits.push(`${json.errors.length} failed`)
      setStatus(bits.join(', ') + '.')
    } finally { setBusy(false) }
  }

  async function runImport(isDry: boolean) {
    setBusy(true); setStatus(null)
    try {
      const { ok, json } = await post('/api/accounting/quickbooks/import', {
        text: journalText, dryRun: isDry,
      })
      if (!ok) { setStatus(json?.error ?? 'Import failed.'); return }
      if (isDry) { setDryRun(json); return }
      setDryRun(null)
      setStatus(`Created ${json.created} draft entr${json.created === 1 ? 'y' : 'ies'}; ${json.alreadyPresent} already present; ${json.skipped} skipped.`)
      await loadRuns()
    } finally { setBusy(false) }
  }

  async function runTieOut() {
    setBusy(true); setStatus(null)
    try {
      const { ok, json } = await post('/api/accounting/quickbooks/tie-out', { text: tbText, asOf: tbAsOf })
      if (!ok) { setStatus(json?.error ?? 'Could not tie out.'); return }
      setTieOut(json)
    } finally { setBusy(false) }
  }

  const coverage = parsed
    ? `${Object.values(mapping).filter(Boolean).length} of ${parsed.accounts.length} accounts mapped`
    : null

  return (
    <div className="space-y-6">
      {status && <p className="text-sm text-warning">{status}</p>}

      {/* ---- Step 1 -------------------------------------------------------- */}
      <Card className="rounded-card">
        <CardContent className="p-4 space-y-3">
          <h2 className="text-base font-medium">1 · Paste the QuickBooks Journal export</h2>
          <p className="text-sm text-muted-foreground">
            Reports → Journal → export to CSV or Excel, then paste it here. The Journal is the
            only QuickBooks report that is already double-entry; the General Ledger loses the
            transaction grouping and the Trial Balance has no detail.
          </p>
          <Textarea rows={6} value={journalText} onChange={e => setJournalText(e.target.value)}
                    placeholder="Date,Transaction Type,Num,Name,Memo/Description,Account,Debit,Credit"
                    className="font-mono text-xs" />
          <Button size="sm" onClick={runParse} disabled={busy || !journalText.trim()}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Parse
          </Button>

          {parsed && (
            <div className="space-y-2 pt-2 text-sm">
              <p>
                <CheckCircle2 className="inline h-4 w-4 mr-1 text-success" />
                {parsed.transactionCount} transaction(s)
                {parsed.dateRange && <> from {parsed.dateRange.first} to {parsed.dateRange.last}</>},
                {' '}{parsed.accounts.length} distinct account(s).
              </p>
              {parsed.errors.length > 0 && (
                <div>
                  <p className="text-warning">
                    <AlertTriangle className="inline h-4 w-4 mr-1" />
                    {parsed.errors.length} row-level problem(s) — these were NOT imported:
                  </p>
                  <ul className="list-disc pl-5 text-destructive">
                    {parsed.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Step 2 -------------------------------------------------------- */}
      {parsed && (
        <Card className="rounded-card">
          <CardContent className="p-4 space-y-3">
            <h2 className="text-base font-medium">2 · Map the accounts</h2>
            <p className="text-sm text-muted-foreground">
              Busiest accounts first. Leave an account unmapped to exclude it — every
              transaction touching it is then dropped whole, since importing half of a
              double-entry transaction would not balance. {coverage}.
            </p>

            {parsed.discoveredHoldings.length > 0 && (
              <div className="rounded-lg border border-brand-200 p-3 space-y-2">
                <p className="text-sm">
                  Found {parsed.discoveredHoldings.length} underlying fund(s) in the QuickBooks
                  chart: {parsed.discoveredHoldings.join(', ')}.
                </p>
                <Button size="sm" variant="outline" onClick={discoverHoldings} disabled={busy}>
                  Create {parsed.discoveredHoldings.length} fund holding(s)
                </Button>
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>QuickBooks account</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead>Maps to</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.accounts.map(a => (
                  <TableRow key={a.qbAccount}>
                    <TableCell className="font-medium">{a.qbAccount}</TableCell>
                    <TableCell className="text-right tabular-nums">—</TableCell>
                    <TableCell>
                      <select
                        value={mapping[a.qbAccount] ?? ''}
                        onChange={e => setMapping(m => ({ ...m, [a.qbAccount]: e.target.value }))}
                        className="border rounded-lg px-2 py-1 text-sm"
                      >
                        <option value="">Exclude from import</option>
                        {chart.map(c => (
                          <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell className={`text-sm ${a.confidence === 'none' ? 'text-warning' : 'text-muted-foreground'}`}>
                      {a.reason}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Button size="sm" onClick={saveMapping} disabled={busy}>Save mapping</Button>
          </CardContent>
        </Card>
      )}

      {/* ---- Step 3 -------------------------------------------------------- */}
      {parsed && (
        <Card className="rounded-card">
          <CardContent className="p-4 space-y-3">
            <h2 className="text-base font-medium">3 · Import</h2>
            <p className="text-sm text-muted-foreground">
              Every entry imports as a DRAFT and is posted from the journal page. Re-running is
              safe — entries already imported are matched by their content hash, not duplicated.
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => runImport(true)} disabled={busy}>Dry run</Button>
              <Button size="sm" onClick={() => runImport(false)} disabled={busy}>Import as drafts</Button>
            </div>

            {dryRun && (
              <p className="text-sm">
                Would create {dryRun.wouldCreate}; {dryRun.alreadyPresent} already present;
                {' '}{dryRun.skipped} skipped.
              </p>
            )}

            {runs.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead className="text-right">Parsed</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="text-right">Matched</TableHead>
                    <TableHead className="text-right">Skipped</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="tabular-nums text-xs">{String(r.created_at).slice(0, 19).replace('T', ' ')}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.transactions_parsed}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.entries_created}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.entries_matched}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.transactions_skipped}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- Step 4 -------------------------------------------------------- */}
      <Card className="rounded-card">
        <CardContent className="p-4 space-y-3">
          <h2 className="text-base font-medium">4 · Tie out to QuickBooks</h2>
          <p className="text-sm text-muted-foreground">
            Paste the QuickBooks trial balance for a period end. The migration is done when
            every period ties — not when the import runs without errors. Repeat per period.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">As of</span>
            <input type="date" value={tbAsOf} onChange={e => setTbAsOf(e.target.value)}
                   className="border rounded-lg px-2 py-1 text-sm" />
          </div>
          <Textarea rows={5} value={tbText} onChange={e => setTbText(e.target.value)}
                    placeholder="Account,Debit,Credit" className="font-mono text-xs" />
          <Button size="sm" onClick={runTieOut} disabled={busy || !tbText.trim() || !tbAsOf}>
            Compare
          </Button>

          {tieOut && (
            <div className="space-y-2 pt-2">
              {tieOut.ties ? (
                <p className="text-sm text-success">
                  <CheckCircle2 className="inline h-4 w-4 mr-1" />
                  Every mapped account ties at {tieOut.asOf}.
                </p>
              ) : (
                <>
                  <p className="text-sm text-warning">
                    <AlertTriangle className="inline h-4 w-4 mr-1" />
                    {tieOut.lines.length} account(s) differ at {tieOut.asOf}.
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Ours</TableHead>
                        <TableHead className="text-right">QuickBooks</TableHead>
                        <TableHead className="text-right">Difference</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tieOut.lines.map(l => (
                        <TableRow key={l.code}>
                          <TableCell className="tabular-nums">{l.code}</TableCell>
                          <TableCell>{l.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(l.ours)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(l.theirs)}</TableCell>
                          <TableCell className="text-right tabular-nums text-warning">{fmt(l.difference)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
              <p className="text-xs text-muted-foreground">
                Includes draft entries, since imported entries stay drafts until they are
                reviewed and posted.
                {tieOut.unmappedAccounts.length > 0 && (
                  <> {tieOut.unmappedAccounts.length} QuickBooks account(s) are unmapped and were
                  excluded from the comparison: {tieOut.unmappedAccounts.join(', ')}.</>
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-card border-warning">
        <CardContent className="p-4 space-y-2">
          <h2 className="text-base font-medium">Before you call it done</h2>
          <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
            <li>
              <strong>Set the ledger start date</strong> on the vehicle to the day after the last
              tied period. Register events before it are memo-only and post nothing, because
              QuickBooks already posted them.
            </li>
            <li>
              <strong>Attribute LP capital per partner.</strong> QuickBooks carries partners&rsquo;
              capital pooled, so per-LP history has to come from the spreadsheet. Capital left on
              the pooled account balances perfectly while every LP shows zero — the close blocks
              on this, and it is the failure this migration produces if the step is skipped.
            </li>
            <li><strong>Post the drafts</strong> from the journal page once the tie-out is green.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
