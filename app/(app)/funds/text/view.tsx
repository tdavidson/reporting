'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLedgerFetch, useVehicle } from '@/components/accounting-vehicle'
import { parseLedgerText, resolvePostingAccounts, textAccountName } from '@/lib/accounting/text-ledger'
import type { Account, AccountType } from '@/lib/accounting/types'

const SAMPLE = `; One transaction per block: DATE FLAG "narration", then indented postings.
; * posts, ! saves a draft. Debits positive, credits negative; one amount per entry may be left off.
; Accounts by full name (Assets:Cash:1000) or just the code (1000).

2025-07-15 * "Investment — purchase"
  source: "manual"
  Assets:Investments-At-Cost:1100     4800000.00 USD
  Assets:Cash:1000
`

/**
 * Author entries as plain text and post them in one go — the power user's journal, and the
 * format the period close snapshots. The parse runs as you type, against this vehicle's chart,
 * so an unknown account or an unbalanced block is named before anything is sent.
 *
 * A tab of the journal page (see ../journal/page-view.tsx), not a page of its own. `onPosted`
 * is called after a clean post so the page can switch back to the list the entries landed in;
 * it is not called when anything was refused, because the problems are reported here.
 */
export function TextLedgerView({ onPosted }: { onPosted?: () => void } = {}) {
  const lf = useLedgerFetch()
  const { group } = useVehicle()
  const [text, setText] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ledger, setLedger] = useState<string | null>(null)
  const [ledgerBusy, setLedgerBusy] = useState(false)

  useEffect(() => {
    lf('/api/accounting/chart').then(r => (r.ok ? r.json() : [])).then((rows: any[]) => {
      setAccounts((Array.isArray(rows) ? rows : []).map(a => ({
        id: a.id, fundId: '', code: a.code, name: a.name, type: a.type as AccountType, subtype: a.subtype ?? null, lpEntityId: a.lp_entity_id ?? null,
      })))
    })
  }, [lf])

  const parsed = useMemo(() => {
    if (!text.trim()) return null
    const { entries, errors } = parseLedgerText(text)
    const byId = new Map(accounts.map(a => [a.id, a]))
    const rows = entries.map(e => {
      const { postings, unknown } = resolvePostingAccounts(accounts, e.postings)
      return { entry: e, postings: postings.map(p => ({ ...p, account: byId.get(p.accountId) })), unknown }
    })
    return { rows, errors, unknown: Array.from(new Set(rows.flatMap(r => r.unknown))) }
  }, [text, accounts])

  const okCount = parsed ? parsed.rows.filter(r => r.unknown.length === 0).length : 0
  const canPost = !!parsed && okCount > 0 && parsed.errors.length === 0 && parsed.unknown.length === 0

  async function post(status: 'draft' | 'posted') {
    setBusy(true); setError(null); setResult(null)
    const res = await lf('/api/accounting/ledger-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, status }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setError(d?.error ?? 'Could not post'); setBusy(false); return }
    const problems: string[] = [...(d.errors ?? []), ...((d.unknownAccounts ?? []).map((u: string) => `Unknown account ${u}`))]
    setResult(`${status === 'posted' ? 'Posted' : 'Saved as drafts'}: ${d.posted} ${d.posted === 1 ? 'entry' : 'entries'}.${problems.length ? ` ${problems.length} problem${problems.length === 1 ? '' : 's'}: ${problems.join('; ')}` : ''}`)
    if (problems.length === 0) setText('')
    setBusy(false)
    if (problems.length === 0 && d.posted > 0) onPosted?.()
  }

  async function showLedger() {
    if (ledger !== null) { setLedger(null); return }
    setLedgerBusy(true)
    const res = await lf('/api/accounting/ledger-text')
    const d = await res.json().catch(() => ({}))
    setLedger(res.ok ? (d.text ?? '') : `Could not load: ${d?.error ?? res.status}`)
    setLedgerBusy(false)
  }

  const downloadHref = `/api/accounting/ledger-text?download=1${group ? `&group=${encodeURIComponent(group)}` : ''}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setText(t => (t.trim() ? t : SAMPLE))}>Insert an example</Button>
        <Button size="sm" variant="outline" onClick={showLedger} disabled={ledgerBusy}>
          {ledgerBusy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}{ledger === null ? 'Show current ledger' : 'Hide current ledger'}
        </Button>
        <a href={downloadHref} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted">
          <Download className="h-4 w-4" />Download ledger as text
        </a>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => post('draft')} disabled={busy || !canPost}>Save as drafts</Button>
          <Button size="sm" onClick={() => post('posted')} disabled={busy || !canPost}>{busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Post</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <textarea
          value={text}
          onChange={e => { setText(e.target.value); setResult(null) }}
          spellCheck={false}
          placeholder={'2025-07-15 * "Narration"\n  Assets:Cash:1000        1000.00 USD\n  Equity:Partners-Capital-LP:3100'}
          className="min-h-[24rem] w-full rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed"
        />
        <div className="space-y-2">
          {!parsed ? (
            <p className="text-sm text-muted-foreground">Type or paste entries on the left. They are checked here as you go — balance, dates, and whether every account is in this vehicle&rsquo;s chart.</p>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                {parsed.rows.length} {parsed.rows.length === 1 ? 'entry' : 'entries'} parsed{okCount !== parsed.rows.length ? `, ${parsed.rows.length - okCount} with an unknown account` : ''}.
              </div>
              {parsed.errors.map((er, i) => <p key={i} className="text-sm text-warning">{er}</p>)}
              {parsed.unknown.length > 0 && (
                <p className="text-sm text-warning">Unknown accounts: {parsed.unknown.join(', ')}. Use a code from the chart, or add the account on Admin first.</p>
              )}
              <div className="divide-y rounded-md border font-mono text-xs">
                {parsed.rows.map((r, i) => (
                  <div key={i} className="px-3 py-2">
                    <div>
                      <span className="text-muted-foreground">{r.entry.date}</span>{' '}
                      <span className={`rounded px-1 py-0.5 font-sans text-[9px] font-medium uppercase tracking-wide ${r.entry.flag === '!' ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}>{r.entry.flag === '!' ? 'draft' : 'post'}</span>{' '}
                      &quot;{r.entry.narration}&quot;
                      {r.entry.sourceType && <span className="text-muted-foreground/70">  source: &quot;{r.entry.sourceType}&quot;</span>}
                    </div>
                    {r.postings.map((p, j) => (
                      <div key={j} className="flex items-baseline gap-3 pl-4">
                        <span className="min-w-0 flex-1 break-all">{p.account ? textAccountName(p.account) : '?'}</span>
                        <span className="w-24 shrink-0 text-right tabular-nums">{p.amount > 0 ? p.amount.toFixed(2) : ''}</span>
                        <span className="w-24 shrink-0 text-right tabular-nums">{p.amount < 0 ? (-p.amount).toFixed(2) : ''}</span>
                      </div>
                    ))}
                    {r.unknown.map(u => <div key={u} className="pl-4 text-warning">unknown: {u}</div>)}
                  </div>
                ))}
              </div>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && <p className="text-sm text-success">{result}</p>}
        </div>
      </div>

      {ledger !== null && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">The vehicle&rsquo;s posted ledger, as text. Read-only here — copy a block into the editor to use it as a template; pasting the whole thing back would book everything twice.</p>
          <pre className="max-h-[32rem] overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">{ledger}</pre>
        </div>
      )}
    </div>
  )
}
