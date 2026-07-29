'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLedgerFetch, useFundSeg } from '@/components/accounting-vehicle'
import { textAccountName } from '@/lib/accounting/text-ledger'
import type { Account, AccountType } from '@/lib/accounting/types'
import { PeriodPicker } from '@/components/accounting/period-picker'
import {
  customPeriod, periodTriggerLabel, resolvePeriod, type PeriodPreset,
} from '@/lib/accounting/statement-period'
import { chunkIds, describeSkipped, summarizeSelection } from '@/lib/accounting/journal-selection'
import { EntryModal } from '../entry-modal'
import { EmptyState } from '@/components/ui/empty-state'

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
  const fundSeg = useFundSeg()

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
  // Ticked entry ids on the current page. `allMatching` is the escalation past it: every
  // draft in the filtered window, including the ones no page has shown yet.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [allMatching, setAllMatching] = useState(false)

  // Debounce the search box → server query. Reset page in the same state
  // transition so the fetch effect (below) recomputes and fires exactly once.
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const loadPage = useCallback(() => {
    setError(null)
    setLoading(true)
    // Any reload — a filter change, a page turn, or the refresh after posting — invalidates
    // the selection: the ids on screen are about to be different ones.
    setSelected(new Set())
    setAllMatching(false)
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

  const sel = useMemo(() => summarizeSelection(entries, selected), [entries, selected])
  const rangeLabel = periodTriggerLabel(preset, start, end)
  // The escalation is only offered when it would be honest: bulk-post filters by date and id,
  // it has no free-text search, so with a query active "all matching" would silently mean
  // something wider than what's on screen.
  const canEscalate = sel.allPageSelected && !allMatching && total > entries.length && !debounced

  const toggleRow = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleAll = () => {
    setAllMatching(false)
    setSelected(sel.allPageSelected ? new Set() : new Set(sel.selectableIds))
  }
  const clearSelection = () => { setSelected(new Set()); setAllMatching(false) }

  // Indeterminate isn't an attribute — it only exists on the DOM node.
  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = !sel.allPageSelected && sel.selectedIds.length > 0
    }
  }, [sel.allPageSelected, sel.selectedIds.length])

  // Post the ticked drafts. Two request shapes, because the two scopes page differently:
  //   - an explicit selection goes as `ids`, chunked at the endpoint's 500-row cap (that path
  //     has no cursor, so the client does the paging);
  //   - the escalated "every draft in range" goes as start/end and follows the server's keyset
  //     cursor, which advances past entries too stuck to post.
  // Either way the server re-checks draft status, balance and closed periods per entry, and
  // hands back the ones it refused.
  const postDrafts = useCallback(() => {
    const ids = allMatching ? null : sel.draftIds
    if (ids && ids.length === 0) return
    const scope = ids
      ? `${ids.length} selected draft${ids.length === 1 ? '' : 's'}`
      : `every draft in ${rangeLabel}`
    if (!window.confirm(`Post ${scope} to the ledger? This cannot be bulk-undone.`)) return

    setPosting(true)
    setPostMsg(null)
    const win = preset === 'custom' ? customPeriod(start, end) : resolvePeriod(preset)
    let totalPosted = 0
    // Keyed by id so a stuck entry counts once however many pages it survives.
    const skipped: Record<string, string> = {}

    const call = (body: Record<string, unknown>) =>
      lf('/api/accounting/journal/bulk-post', { method: 'POST', body: JSON.stringify(body) })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error('bulk-post failed'))))
        .then((d: { posted?: number; skipped?: { id: string; reason: string }[]; hasMore?: boolean; cursor?: string | null }) => {
          totalPosted += d.posted ?? 0
          if (Array.isArray(d.skipped)) for (const s of d.skipped) skipped[s.id] = s.reason
          return d
        })

    const stepAll = (afterId: string | null, iter: number): Promise<void> => {
      if (iter >= 200) return Promise.resolve() // backstop against a server that never stops claiming hasMore
      return call({
        ...(win.start ? { start: win.start } : {}),
        ...(win.end ? { end: win.end } : {}),
        ...(afterId ? { afterId } : {}),
      }).then(d => { if (d.hasMore && d.cursor) return stepAll(d.cursor, iter + 1) })
    }

    const run: Promise<unknown> = ids
      ? chunkIds(ids).reduce<Promise<unknown>>((p, batch) => p.then(() => call({ ids: batch })), Promise.resolve())
      : stepAll(null, 0)

    let failed = false
    run
      .catch(() => { failed = true })
      .then(() => {
        setPostMsg(failed
          ? 'Could not post draft entries.'
          : `Posted ${totalPosted} ${totalPosted === 1 ? 'entry' : 'entries'}. ${describeSkipped(Object.keys(skipped).map(id => ({ id, reason: skipped[id] })))}`.trim())
        setPosting(false)
        loadPage() // also clears the selection
      })
  }, [lf, loadPage, allMatching, sel.draftIds, rangeLabel, preset, start, end])

  return (
    <div className="space-y-4">
      {/* One row, always. The period control is a single popover trigger, so picking Custom
          no longer drops two date inputs into this row and wraps it. Bulk actions live in the
          selection strip below, and pagination BELOW the table (see footer). */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing({ entryId: null })}>
          <Plus className="h-4 w-4 mr-1" />New entry
        </Button>
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search memo, source, date, account, or amount…"
          className="h-9 min-w-[10rem] max-w-xs flex-1"
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
        {error && <span className="text-sm text-warning">{error}</span>}
        <div className="ml-auto">
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
        <EmptyState
          // No action on the search-miss variant: the search box is right there,
          // and offering an import would answer a question nobody asked.
          action={!debounced && fundSeg && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/funds/${fundSeg}/bank`}>Import bank transactions</Link>
            </Button>
          )}
        >
          {debounced ? 'No entries match your search in this period.' : 'No journal entries in this period. Widen the range, or create one above.'}
        </EmptyState>
      ) : (
        <div className="space-y-2">
        {/* Selection strip. Always rendered while there are entries, so its presence never
            depends on state and the list below never jumps. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={sel.allPageSelected}
            onChange={toggleAll}
            aria-label="Select all entries on this page"
          />
          {allMatching ? (
            <span className="font-medium">All drafts in {rangeLabel} are selected.</span>
          ) : sel.selectedIds.length === 0 ? (
            <span className="text-muted-foreground">Select all {sel.selectableIds.length} on this page</span>
          ) : (
            <span>
              {sel.selectedIds.length} selected
              <span className="text-muted-foreground"> · {sel.draftIds.length} draft{sel.draftIds.length === 1 ? '' : 's'}</span>
            </span>
          )}

          {canEscalate && (
            <button
              type="button"
              onClick={() => setAllMatching(true)}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {/* `total` counts the active filter, so it's only a draft count when the status
                  filter already says Draft. Otherwise offer the action without a number
                  rather than quote one that includes posted entries. */}
              {status === 'draft'
                ? `Select all ${total} drafts in ${rangeLabel}`
                : `Select every draft in ${rangeLabel}`}
            </button>
          )}

          {/* One right-aligned group, so the result message and the buttons can't each claim
              the auto margin and end up fighting over the same edge. */}
          <div className="ml-auto flex items-center gap-2">
            {postMsg && <span className="text-muted-foreground">{postMsg}</span>}
            {(allMatching || sel.draftIds.length > 0) && (
              <>
                <Button size="sm" variant="outline" disabled={posting} onClick={postDrafts}>
                  {posting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                  {allMatching ? 'Post all drafts in range' : `Post ${sel.draftIds.length} draft${sel.draftIds.length === 1 ? '' : 's'}`}
                </Button>
                <Button size="sm" variant="ghost" disabled={posting} onClick={clearSelection}>Clear</Button>
              </>
            )}
          </div>
        </div>

        <div className="border rounded-lg divide-y font-mono text-xs">
          {entries.map(e => {
            const narration = (e.memo || e.source_type || 'Entry').replace(/"/g, "'")
            // Readable status marker instead of a cryptic */!/# flag.
            const statusCls = e.status === 'posted'
              ? 'bg-success/15 text-success'
              : e.status === 'void' ? 'bg-muted text-muted-foreground' : 'bg-warning/15 text-warning'
            const clickable = e.status !== 'void'
            return (
              <div
                key={e.id}
                // Click the entry itself to open it: read-only if posted (with
                // "Unpost & edit" inside), straight to the form if it's a draft.
                onClick={clickable ? () => setEditing({ entryId: e.id, readOnly: e.status === 'posted' }) : undefined}
                className={`group px-3 py-2 ${clickable ? 'cursor-pointer hover:bg-muted/30' : 'opacity-50 line-through'}`}
              >
                <div className="flex items-start gap-3">
                  {/* Fixed-width gutter whether or not the row has a box, so the entry text
                      stays on one left edge. The span swallows the click that would
                      otherwise open the entry modal. */}
                  <span className="flex w-4 shrink-0 justify-center pt-0.5" onClick={ev => ev.stopPropagation()}>
                    {clickable && (
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => toggleRow(e.id)}
                        aria-label={`Select entry ${e.entry_date}`}
                      />
                    )}
                  </span>
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
