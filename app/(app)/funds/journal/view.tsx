'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { textAccountName } from '@/lib/accounting/text-ledger'
import type { Account, AccountType } from '@/lib/accounting/types'
import { PeriodPicker } from '@/components/accounting/period-picker'
import type { PeriodPreset } from '@/lib/accounting/statement-period'
import { EntryModal } from '../entry-modal'

interface Posting { id: string; account_id: string; account_code: string | null; account_name: string | null; account_type: string | null; amount: number; currency: string | null; lp_entity_id: string | null }
interface Entry {
  id: string
  entry_date: string
  memo: string | null
  source_type: string | null
  status: string
  journal_postings: Posting[]
}

// Same action-button style as the bank transactions table.
const actionBtn = 'shrink-0 rounded border border-input px-2 py-1 font-sans text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'

const PAGE = 50

export function JournalView() {
  const lf = useLedgerFetch()

  const [entries, setEntries] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [preset, setPreset] = useState<PeriodPreset>('ytd')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [status, setStatus] = useState<'all' | 'draft' | 'posted'>('all')
  const [page, setPage] = useState(0)
  // `{ entryId: null }` = a new entry; readOnly = view a posted one without reverting it.
  const [editing, setEditing] = useState<{ entryId: string | null; readOnly?: boolean } | null>(null)
  const [posting, setPosting] = useState(false)
  const [postMsg, setPostMsg] = useState<string | null>(null)

  // Debounce the search box → server query. Reset page in the same state
  // transition so the fetch effect (below) recomputes and fires exactly once.
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const loadPage = useCallback(() => {
    setError(null)
    setLoading(true)
    const qs = new URLSearchParams({ preset, limit: String(PAGE), offset: String(page * PAGE) })
    if (preset === 'custom') { if (start) qs.set('start', start); if (end) qs.set('end', end) }
    if (debounced) qs.set('q', debounced)
    if (status !== 'all') qs.set('status', status)
    lf(`/api/accounting/journal?${qs}`)
      .then(r => (r.ok ? r.json() : { entries: [], total: 0 }))
      .then(d => { setEntries(Array.isArray(d.entries) ? d.entries : []); setTotal(d.total ?? 0) })
      .catch(() => setError('Could not load entries'))
      .finally(() => setLoading(false))
  }, [lf, preset, start, end, debounced, status, page])
  useEffect(() => { loadPage() }, [loadPage])

  // Post every draft entry for this vehicle, one page at a time (the endpoint caps a
  // single call at 500 rows and returns `remaining` so we know whether to loop).
  const postAllDrafts = useCallback(() => {
    if (!window.confirm('Post all draft entries for this vehicle to the ledger? This cannot be bulk-undone.')) return
    setPosting(true)
    setPostMsg(null)
    let totalPosted = 0
    const skippedAll: { id: string; reason: string }[] = []
    let failed = false
    const step = (iter: number): Promise<void> => {
      if (iter >= 50) return Promise.resolve()
      return lf('/api/accounting/journal/bulk-post', { method: 'POST', body: JSON.stringify({}) })
        .then(r => (r.ok ? r.json() : { posted: 0, skipped: [], remaining: 0 }))
        .then(d => {
          totalPosted += d.posted ?? 0
          if (Array.isArray(d.skipped)) skippedAll.push(...d.skipped)
          if ((d.remaining ?? 0) > 0) return step(iter + 1)
        })
        .catch(() => { failed = true })
    }
    step(0).finally(() => {
      setPostMsg(failed
        ? 'Could not post draft entries.'
        : `Posted ${totalPosted} entries.${skippedAll.length ? ` ${skippedAll.length} skipped (closed period or out of balance).` : ''}`)
      setPosting(false)
      loadPage()
    })
  }, [lf, loadPage])

  return (
    <div className="space-y-4">
      {/* Actions + search on the left; the period controls are right-aligned so the
          extra From/To inputs that appear in Custom mode grow leftward and don't shove
          the rest of the row around. Pagination lives BELOW the table (see footer). */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing({ entryId: null })}>
          <Plus className="h-4 w-4 mr-1" />New entry
        </Button>
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search memo, source, date, account, or amount…"
          className="h-9 max-w-xs"
        />
        <select
          value={status}
          onChange={e => { setStatus(e.target.value as 'all' | 'draft' | 'posted'); setPage(0) }}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="all">All entries</option>
          <option value="draft">Draft</option>
          <option value="posted">Posted</option>
        </select>
        <Button size="sm" variant="outline" disabled={posting} onClick={postAllDrafts}>
          {posting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
          Post all drafts
        </Button>
        {postMsg && <span className="text-xs text-muted-foreground">{postMsg}</span>}
        {error && <span className="text-xs text-amber-600">{error}</span>}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <PeriodPicker
            preset={preset} onPreset={p => { setPreset(p); setPage(0) }}
            start={start} end={end}
            onStart={v => { setStart(v); setPage(0) }} onEnd={v => { setEnd(v); setPage(0) }}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : entries.length === 0 ? (
        <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">
          {debounced ? 'No entries match your search in this period.' : 'No journal entries in this period. Widen the range, create one above, or import bank transactions.'}
        </div>
      ) : (
        <div className="border rounded-lg divide-y font-mono text-xs">
          {entries.map(e => {
            const narration = (e.memo || e.source_type || 'Entry').replace(/"/g, "'")
            // Readable status marker instead of a cryptic */!/# flag.
            const statusCls = e.status === 'posted'
              ? 'bg-green-500/15 text-green-600'
              : e.status === 'void' ? 'bg-muted text-muted-foreground' : 'bg-amber-500/15 text-amber-600'
            const clickable = e.status !== 'void'
            return (
              <div
                key={e.id}
                // Click the entry itself to open it: read-only if posted (with
                // "Unpost & edit" inside), straight to the form if it's a draft.
                onClick={clickable ? () => setEditing({ entryId: e.id, readOnly: e.status === 'posted' }) : undefined}
                className={`group px-3 py-2 ${clickable ? 'cursor-pointer hover:bg-muted/30' : 'opacity-50 line-through'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 leading-relaxed">
                    <div className="whitespace-pre-wrap break-words">
                      <span className="text-muted-foreground">{e.entry_date}</span>{' '}
                      <span className={`mr-1 rounded px-1 py-0.5 align-middle font-sans text-[9px] font-medium uppercase tracking-wide ${statusCls}`}>{e.status}</span>{' '}
                      <span>&quot;{narration}&quot;</span>
                    </div>
                    {e.source_type && (
                      <div className="text-muted-foreground/70">{'  '}source: &quot;{e.source_type}&quot;</div>
                    )}
                    {/* Aligned by layout, not by padding the name to the longest account
                        in the chart — the per-LP capital accounts are long enough to push
                        the amounts clean out of the container. */}
                    {e.journal_postings.map(p => {
                      const name = p.account_code
                        ? textAccountName({ id: p.account_id, fundId: '', code: p.account_code, name: p.account_name ?? '', type: (p.account_type as AccountType) } as Account)
                        : `Unknown:${p.account_id.slice(0, 8)}`
                      const amt = Number(p.amount)
                      return (
                        <div key={p.id} className="flex items-baseline gap-3 pl-4">
                          <span className="min-w-0 flex-1 break-all">{name}</span>
                          <span className={`shrink-0 text-right tabular-nums ${amt < 0 ? 'text-muted-foreground' : ''}`}>
                            {amt.toFixed(2)}
                          </span>
                          <span className="w-8 shrink-0 text-muted-foreground">{p.currency ?? 'USD'}</span>
                        </div>
                      )
                    })}
                  </div>

                  {/* Same action as a posted bank transaction: one button that opens the
                      entry read-only, with "Unpost & edit" in the modal footer. */}
                  {clickable && (
                    <button
                      onClick={ev => { ev.stopPropagation(); setEditing({ entryId: e.id, readOnly: e.status === 'posted' }) }}
                      title={e.status === 'posted' ? 'See the entry — unpost from there to edit it' : 'Edit this draft'}
                      className={actionBtn}
                    >
                      {e.status === 'posted' ? 'View / edit' : 'Edit'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination below the table — its position doesn't shift when Custom mode adds
          the From/To inputs to the toolbar above. */}
      {total > 0 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>Showing {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total}</span>
          <Button size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => setPage(p => Math.max(0, p - 1))}>Prev</Button>
          <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total || loading} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {editing && (
        <EntryModal
          entryId={editing.entryId}
          readOnly={editing.readOnly}
          onClose={() => setEditing(null)}
          onSaved={loadPage}
        />
      )}
    </div>
  )
}
