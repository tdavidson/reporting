'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, Check, AlertTriangle, Upload, Sparkles, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { EntryModal } from '../entry-modal'
import { EmptyState } from '@/components/ui/empty-state'

interface Txn { id: string; txn_date: string; amount: number; description: string; counterparty: string | null; status: string; suggested_account_code: string | null; journal_entry_id: string | null; settled_lp_entity_id: string | null; settled_lp_name: string | null }
interface Rec { bankEndingBalance: number; ledgerCashBalance: number; difference: number; matchedCount: number; unmatchedCount: number; unmatchedTotal: number; tiesOut: boolean }
interface Lp { lpEntityId: string; name: string; commitment: number }

const actionBtn = 'text-xs border border-input rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'

export function BankView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const [csv, setCsv] = useState('')
  const [txns, setTxns] = useState<Txn[]>([])
  const [rec, setRec] = useState<Rec | null>(null)
  const [lps, setLps] = useState<Lp[]>([])
  const [acctNames, setAcctNames] = useState<Record<string, string>>({})
  /** Why a match/book action was refused. Shown rather than swallowed. */
  const [matchError, setMatchError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<{ code: string; name: string; is_active?: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [categorizing, setCategorizing] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const [editing, setEditing] = useState<{ txnId: string; entryId: string; readOnly?: boolean } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortBy, setSortBy] = useState('date-desc')
  const lf = useLedgerFetch()

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      lf('/api/accounting/bank').then(r => (r.ok ? r.json() : [])),
      lf('/api/accounting/bank/reconcile').then(r => (r.ok ? r.json() : null)),
      lf('/api/accounting/chart').then(r => (r.ok ? r.json() : [])),
      lf('/api/accounting/entities').then(r => (r.ok ? r.json() : [])),
    ]).then(([t, r, ch, lpRows]) => {
      setLps(Array.isArray(lpRows) ? lpRows : [])
      setTxns(Array.isArray(t) ? t : [])
      setSelected(new Set())
      setRec(r)
      const chart = (Array.isArray(ch) ? ch : []).map((a: any) => ({ code: a.code, name: a.name, is_active: a.is_active }))
      setAccounts(chart)
      setAcctNames(Object.fromEntries(chart.map(a => [a.code, a.name])))
    }).finally(() => setLoading(false))
  }, [lf])

  useEffect(() => { load() }, [load])

  const [matching, setMatching] = useState(false)
  const [matchMsg, setMatchMsg] = useState<string | null>(null)

  /**
   * Settle drafted rows against DECLARED calls and distributions. Runs automatically after an
   * import; this button re-runs it, which matters after declaring something new.
   */
  const autoMatch = useCallback(async (silent = false) => {
    if (!silent) { setMatching(true); setMatchMsg(null) }
    const res = await lf('/api/accounting/bank/auto-match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    const d = await res.json().catch(() => ({}))
    if (!silent) {
      setMatching(false)
      setMatchMsg(res.ok
        ? `Matched ${d.matched?.length ?? 0}.` +
          (d.ambiguous?.length ? ` ${d.ambiguous.length} could be more than one partner — pick below.` : '') +
          (d.unmatched ? ` ${d.unmatched} had no declared call or distribution to settle.` : '')
        : (d.error ?? 'Auto-match failed'))
    }
    load()
  }, [lf, load])

  async function categorize() {
    setCategorizing(true)
    await lf('/api/accounting/bank/categorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    setCategorizing(false)
    load()
  }

  async function match(id: string, mode: 'allocate' | 'link' | 'distribute', entryId?: string, lpEntityId?: string) {
    setMatchError(null)
    const res = await lf('/api/accounting/bank/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, mode, entryId, lpEntityId }) })
    // These can legitimately refuse — a distribution against partners with no capital balance,
    // a closed period, an entry already claimed. The result was being discarded, so a refusal
    // looked exactly like a success that changed nothing.
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setMatchError(body.error || 'That could not be booked.')
      return
    }
    load()
  }

  async function doImport() {
    setImporting(true); setResult(null)
    const res = await lf('/api/accounting/bank/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) })
    const data = await res.json()
    // Settle anything that pays a declared call or distribution before the AI sees it — an
    // obligation is a fact, and guessing an expense account for it would only be worse.
    if (res.ok) { setResult(data); setCsv(''); await autoMatch(true) }
    else setResult({ imported: 0, skipped: 0, errors: [data.error ?? 'Import failed'] })
    setImporting(false)
  }

  async function act(id: string, action: 'post' | 'ignore' | 'unpost' | 'restore') {
    await lf('/api/accounting/bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id }) })
    load()
  }

  const visibleTxns = txns
    .filter(t => (statusFilter ? t.status === statusFilter : true))
    .filter(t => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return (t.description ?? '').toLowerCase().includes(q) || (t.counterparty ?? '').toLowerCase().includes(q)
    })
    .slice()
    .sort((a, b) => {
      switch (sortBy) {
        case 'date-asc': return a.txn_date.localeCompare(b.txn_date)
        case 'amount-desc': return Math.abs(b.amount) - Math.abs(a.amount)
        case 'amount-asc': return Math.abs(a.amount) - Math.abs(b.amount)
        default: return b.txn_date.localeCompare(a.txn_date)
      }
    })
  const draftedIds = visibleTxns.filter(t => t.status === 'drafted').map(t => t.id)
  const allDraftedSelected = draftedIds.length > 0 && draftedIds.every(id => selected.has(id))
  const selectedCount = draftedIds.filter(id => selected.has(id)).length
  function toggleRow(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAll() {
    setSelected(allDraftedSelected ? new Set<string>() : new Set(draftedIds))
  }
  async function bulkPost() {
    if (selectedCount === 0) return
    await lf('/api/accounting/bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'postMany', ids: draftedIds.filter(id => selected.has(id)) }) })
    load()
  }

  async function setAccount(id: string, code: string) {
    setTxns(prev => prev.map(t => (t.id === id ? { ...t, suggested_account_code: code } : t))) // optimistic
    const res = await lf('/api/accounting/bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'setAccount', id, accountCode: code }) })
    if (!res.ok) load() // revert on failure (e.g. custom allocation)
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (/\.xlsx?$/i.test(file.name)) {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      setCsv(XLSX.utils.sheet_to_csv(sheet))
    } else {
      setCsv(await file.text())
    }
    e.target.value = ''
  }

  return (
    <div className="space-y-6">
      {matchError && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span className="flex-1">{matchError}</span>
          <button onClick={() => setMatchError(null)} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">×</button>
        </div>
      )}

      {/* Import */}
      <div className="border rounded-card p-4 space-y-2">
        <p className="text-sm font-medium">Import transactions</p>
        <p className="text-xs text-muted-foreground">Paste a CSV/TSV export from your bank, Ramp, or QuickBooks. Columns matched automatically (date, description, amount, or debit/credit). Each row is deduped and drafted as a balanced entry for review.</p>
        <textarea value={csv} onChange={e => setCsv(e.target.value)} rows={5} placeholder="Date,Description,Amount&#10;2026-06-01,Capital call Fund II,5000000&#10;2026-06-15,Audit fee,-12000" className="w-full border border-input rounded p-2 text-sm font-mono bg-transparent" />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={doImport} disabled={importing || csv.trim().length < 5}>{importing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}Import</Button>
          <label className="text-xs text-muted-foreground cursor-pointer border rounded px-2 py-1.5 hover:bg-accent">
            Upload CSV/XLS
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={onFile} className="hidden" />
          </label>
          {result && (
            <span className="text-sm text-muted-foreground">
              {result.imported} imported{result.skipped ? `, ${result.skipped} duplicate(s) skipped` : ''}{result.errors.length ? `, ${result.errors.length} error(s)` : ''}.
            </span>
          )}
        </div>
        {result?.errors?.length ? <p className="text-sm text-destructive">{result.errors[0]}</p> : null}
      </div>

      {/* Reconciliation */}
      {rec && (
        <div className={`rounded-card border p-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-1 ${rec.tiesOut ? 'border-success/40 bg-success/10' : 'border-warning/40 bg-warning/10'}`}>
          <span className="flex items-center gap-2 font-medium">
            {rec.tiesOut ? <Check className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
            Bank reconciliation
          </span>
          <span className="text-muted-foreground">Ledger cash <span className="tabular-nums text-foreground">{fmt(rec.ledgerCashBalance)}</span></span>
          <span className="text-muted-foreground">Bank ending <span className="tabular-nums text-foreground">{fmt(rec.bankEndingBalance)}</span></span>
          <span className="text-muted-foreground">Difference <span className={`tabular-nums ${rec.difference !== 0 ? 'text-warning' : 'text-foreground'}`}>{fmt(rec.difference)}</span></span>
          {rec.unmatchedCount > 0 && <span className="text-muted-foreground">{rec.unmatchedCount} unmatched ({fmt(rec.unmatchedTotal)})</span>}
        </div>
      )}

      {/* Transactions */}
      {txns.some(t => t.status === 'drafted') && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Settlement first, guessing second: a wire that pays a declared call or
              distribution is a fact, so it is matched before the categorizer is allowed an
              opinion about it. Runs on import; this re-runs it after a new declaration. */}
          <Button size="sm" variant="outline" onClick={() => autoMatch()} disabled={matching}>
            {matching && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Match declared calls &amp; distributions
          </Button>
          <Button size="sm" variant="outline" onClick={categorize} disabled={categorizing}>
            {categorizing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Categorize with AI
          </Button>
          <span className="text-xs text-muted-foreground">Re-classifies drafted rows against your chart of accounts.</span>
          {selectedCount > 0 && <Button size="sm" onClick={bulkPost}>Post {selectedCount} selected</Button>}
          {matchMsg && <span className="text-xs text-muted-foreground">{matchMsg}</span>}
        </div>
      )}
      {loading && txns.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : txns.length === 0 ? (
        <EmptyState>No transactions yet. Import a feed above.</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search description or counterparty" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9 w-64" />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-9 px-3 rounded-md border border-input bg-background text-sm">
              <option value="">All statuses</option>
              <option value="drafted">Not posted</option>
              <option value="reconciled">Posted</option>
              <option value="ignored">Ignored</option>
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="h-9 px-3 rounded-md border border-input bg-background text-sm">
              <option value="date-desc">Date (newest)</option>
              <option value="date-asc">Date (oldest)</option>
              <option value="amount-desc">Amount (largest)</option>
              <option value="amount-asc">Amount (smallest)</option>
            </select>
            <span className="text-xs text-muted-foreground">{visibleTxns.length} of {txns.length}</span>
          </div>
          {visibleTxns.length === 0 ? (
            <EmptyState>No transactions match your filters.</EmptyState>
          ) : (
          <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Date</th>
                <th className="text-left px-3 py-2 font-medium">Description</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-left px-3 py-2 font-medium">Suggested</th>
                <th className="px-3 py-2 font-medium" />
                <th className="px-2 py-2 w-8 text-center">{draftedIds.length > 0 && <input type="checkbox" aria-label="Select all drafted" checked={allDraftedSelected} onChange={toggleAll} />}</th>
              </tr>
            </thead>
            <tbody>
              {visibleTxns.map(t => (
                <tr key={t.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-3 py-2 tabular-nums text-xs">{t.txn_date}</td>
                  <td className="px-3 py-2">{t.description}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${t.amount < 0 ? 'text-muted-foreground' : ''}`}>{fmt(t.amount)}</td>
                  <td className="px-3 py-2 text-xs">
                    {t.status === 'drafted' ? (
                      <select
                        value={t.suggested_account_code ?? ''}
                        onChange={e => setAccount(t.id, e.target.value)}
                        className="border border-input rounded bg-transparent px-1.5 py-1 text-xs max-w-[220px] hover:bg-accent/50"
                      >
                        {!t.suggested_account_code && <option value="">—</option>}
                        {/* Hidden accounts drop out of the list, except the one this row already
                            uses — otherwise the select would render blank and look broken. */}
                        {accounts.filter(a => a.is_active !== false || a.code === t.suggested_account_code)
                          .map(a => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}
                      </select>
                    ) : t.suggested_account_code ? (
                      <span>
                        <span className="text-foreground">{acctNames[t.suggested_account_code] ?? t.suggested_account_code}</span>
                        {acctNames[t.suggested_account_code] && <span className="ml-1.5 text-muted-foreground/70 font-mono">{t.suggested_account_code}</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {t.status === 'drafted' && (
                      <span className="flex items-center gap-1.5 justify-end">
                        {/* Settlement, not booking. A call or distribution is DECLARED first (creating a
                            1300 receivable or a 2300 payable); auto-matching then settles the wire
                            against it and names the partner. This shows who it landed on and lets
                            you change it — the two "Book as call / Book as distribution" controls
                            that used to live here created capital from the bank page, collapsing
                            recognition and settlement into one step. */}
                        {lps.length > 0 && (
                          <select
                            value={t.settled_lp_entity_id ?? ''}
                            onChange={e => { const v = e.target.value; if (!v) return; match(t.id, t.amount > 0 ? 'allocate' : 'distribute', undefined, v) }}
                            title={t.settled_lp_name
                              ? `Settles against ${t.settled_lp_name} — change if that is the wrong partner`
                              : 'Not matched to a declared call or distribution. Pick the partner to settle it against.'}
                            className={`text-xs border rounded bg-transparent px-2 py-1 max-w-[170px] hover:bg-accent ${t.settled_lp_name ? 'border-input text-foreground' : 'border-dashed border-input text-muted-foreground'}`}
                          >
                            <option value="">{t.settled_lp_name ?? 'Unmatched — pick partner…'}</option>
                            {lps.map(l => <option key={l.lpEntityId} value={l.lpEntityId}>{l.name}</option>)}
                          </select>
                        )}
                        {t.journal_entry_id && <button onClick={() => setEditing({ txnId: t.id, entryId: t.journal_entry_id! })} className={actionBtn}>Edit</button>}
                        <button onClick={() => act(t.id, 'post')} className={actionBtn}>Post</button>
                        <button onClick={() => act(t.id, 'ignore')} className={actionBtn}>Ignore</button>
                      </span>
                    )}
                    {t.status === 'reconciled' && (
                      <span className="flex justify-end">
                        {t.journal_entry_id
                          ? <button onClick={() => setEditing({ txnId: t.id, entryId: t.journal_entry_id!, readOnly: true })} title="See the journal entry that was booked — unpost from there to edit it" className={actionBtn}>View / edit</button>
                          : <button onClick={() => act(t.id, 'unpost')} title="Revert to draft" className={actionBtn}>Unpost</button>}
                      </span>
                    )}
                    {t.status === 'ignored' && (
                      <span className="flex items-center gap-1.5 justify-end">
                        <span className="text-sm text-muted-foreground">Ignored</span>
                        <button onClick={() => act(t.id, 'restore')} title="Restore to draft so you can edit it" className={actionBtn}>Restore</button>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center">{t.status === 'drafted' && <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleRow(t.id)} aria-label="Select transaction" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          )}
        </>
      )}

      {editing && <EntryModal txnId={editing.txnId} entryId={editing.entryId} readOnly={editing.readOnly} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  )
}
