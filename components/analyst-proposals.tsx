'use client'

// Journal entries the Analyst drafted, rendered as reviewable cards. Nothing here posts to the
// books: Apply saves a DRAFT entry the user reviews and posts from the Journal. The apply call
// goes to /api/accounting/assistant, which is admin-gated — the Analyst route never applies.

import { useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'

export interface ProposalPosting { accountCode: string; amount: number; lpEntity?: string | null }
export interface Proposal {
  type: 'create' | 'edit'
  entryId?: string | null
  entryDate: string
  memo: string
  sourceType?: string | null
  postings: ProposalPosting[]
  rationale: string
}

const balanced = (p: Proposal) => Math.abs(p.postings.reduce((s, x) => s + Number(x.amount), 0)) < 0.005

export function AnalystProposals({ proposals, vehicle }: { proposals: Proposal[]; vehicle: string | null }) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const [applied, setApplied] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  async function apply(p: Proposal, idx: number) {
    setBusy(idx); setError(null)
    try {
      const res = await fetch('/api/accounting/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', proposal: p, group: vehicle }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not apply'); return }
      setApplied(a => ({ ...a, [idx]: data.entryId }))
    } catch {
      setError('Could not apply — network error.')
    } finally {
      setBusy(null)
    }
  }

  if (proposals.length === 0) return null

  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Proposed entries</p>
      {proposals.map((p, i) => (
        <div key={i} className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">
              {p.type === 'edit' ? 'Edit' : 'New'} &middot; {p.entryDate} &middot; {p.memo}
            </p>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">{p.sourceType ?? 'manual'}</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium py-1">Account</th>
                <th className="text-right font-medium py-1">Debit</th>
                <th className="text-right font-medium py-1">Credit</th>
              </tr>
            </thead>
            <tbody>
              {p.postings.map((x, j) => (
                <tr key={j} className="border-t">
                  <td className="py-1">
                    <span className="font-mono">{x.accountCode}</span>
                    {x.lpEntity && <span className="ml-1.5 text-muted-foreground">&middot; {x.lpEntity}</span>}
                  </td>
                  <td className="py-1 text-right tabular-nums">{x.amount > 0 ? fmt(x.amount) : ''}</td>
                  <td className="py-1 text-right tabular-nums">{x.amount < 0 ? fmt(-x.amount) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.rationale && <p className="text-[11px] text-muted-foreground">{p.rationale}</p>}
          {applied[i] ? (
            <span className="text-xs text-green-600 flex items-center gap-1"><Check className="h-3.5 w-3.5" />Applied as a draft — review it in the Journal.</span>
          ) : !balanced(p) ? (
            <span className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Doesn&apos;t balance — won&apos;t apply.</span>
          ) : (
            <Button size="sm" variant="outline" onClick={() => apply(p, i)} disabled={busy === i}>
              {busy === i ? 'Applying…' : 'Apply as draft'}
            </Button>
          )}
        </div>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
