'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { textAccountName } from '@/lib/accounting/text-ledger'
import type { Account, AccountType } from '@/lib/accounting/types'
import { EntryModal } from '../entry-modal'

interface Posting { id: string; account_id: string; amount: number; currency: string | null; lp_entity_id: string | null }
interface Entry {
  id: string
  entry_date: string
  memo: string | null
  source_type: string | null
  status: string
  journal_postings: Posting[]
}
interface AcctRow { id: string; code: string; name: string; type: string }

// Same action-button style as the bank transactions table.
const actionBtn = 'shrink-0 rounded border border-input px-2 py-1 font-sans text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'

export function JournalView() {
  const lf = useLedgerFetch()

  const [entries, setEntries] = useState<Entry[]>([])
  const [accounts, setAccounts] = useState<AcctRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // `{ entryId: null }` = a new entry; readOnly = view a posted one without reverting it.
  const [editing, setEditing] = useState<{ entryId: string | null; readOnly?: boolean } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      lf('/api/accounting/journal').then(r => (r.ok ? r.json() : [])),
      lf('/api/accounting/chart').then(r => (r.ok ? r.json() : [])),
    ])
      .then(([e, c]) => {
        setEntries(Array.isArray(e) ? e : [])
        setAccounts(Array.isArray(c) ? c : [])
      })
      .finally(() => setLoading(false))
  }, [lf])
  useEffect(() => { load() }, [load])

  // The same names the plain-text ledger uses (Assets:Cash:1000), so an entry reads
  // exactly as it serializes.
  const acctById = new Map(
    accounts.map(a => [a.id, textAccountName({ id: a.id, fundId: '', code: a.code, name: a.name, type: a.type as AccountType } as Account)])
  )

  const visible = entries.filter(e => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (e.memo ?? '').toLowerCase().includes(q)
      || (e.source_type ?? '').toLowerCase().includes(q)
      || e.entry_date.includes(q)
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing({ entryId: null })}>
          <Plus className="h-4 w-4 mr-1" />New entry
        </Button>
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search memo, source, or date…"
          className="h-9 max-w-xs"
        />
        <span className="text-xs text-muted-foreground">{visible.length} of {entries.length} entries</span>
        {error && <span className="text-xs text-amber-600">{error}</span>}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : entries.length === 0 ? (
        <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">
          No journal entries yet. Create one above, or import bank transactions and categorize them.
        </div>
      ) : (
        <div className="border rounded-lg divide-y font-mono text-xs">
          {visible.map(e => {
            const flag = e.status === 'posted' ? '*' : e.status === 'void' ? '#' : '!'
            const narration = (e.memo || e.source_type || 'Entry').replace(/"/g, "'")
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
                      <span className={e.status === 'posted' ? 'text-green-600' : 'text-amber-600'}>{flag}</span>{' '}
                      <span>&quot;{narration}&quot;</span>
                    </div>
                    {e.source_type && (
                      <div className="text-muted-foreground/70">{'  '}source: &quot;{e.source_type}&quot;</div>
                    )}
                    {/* Aligned by layout, not by padding the name to the longest account
                        in the chart — the per-LP capital accounts are long enough to push
                        the amounts clean out of the container. */}
                    {e.journal_postings.map(p => {
                      const name = acctById.get(p.account_id) ?? `Equity:Unknown:${p.account_id.slice(0, 8)}`
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

      {editing && (
        <EntryModal
          entryId={editing.entryId}
          readOnly={editing.readOnly}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}
