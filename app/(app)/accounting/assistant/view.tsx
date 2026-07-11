'use client'

import { useState } from 'react'
import { Loader2, Sparkles, AlertTriangle, Info, Check, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface ProposalPosting { accountCode: string; amount: number }
interface Proposal {
  type: 'create' | 'edit'
  entryId?: string | null
  entryDate: string
  memo: string
  sourceType?: string | null
  postings: ProposalPosting[]
  rationale: string
}
interface Finding { severity: 'info' | 'warning' | 'error'; title: string; detail: string; entryId?: string | null }
interface Result { summary: string; findings: Finding[]; proposals: Proposal[] }

const SEVERITY = {
  error: { icon: Ban, cls: 'text-red-600' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600' },
  info: { icon: Info, cls: 'text-muted-foreground' },
}

export function AssistantView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()

  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<Record<number, string>>({})

  async function run(prompt?: string) {
    const msg = prompt ?? message
    setLoading(true); setError(null); setResult(null); setApplied({})
    const res = await lf('/api/accounting/assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ask', message: msg }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error ?? 'Request failed'); return }
    setResult(data)
  }

  async function apply(p: Proposal, idx: number) {
    const res = await lf('/api/accounting/assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'apply', proposal: p }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Could not apply'); return }
    setApplied(a => ({ ...a, [idx]: data.entryId }))
  }

  const balanced = (p: Proposal) => Math.abs(p.postings.reduce((s, x) => s + Number(x.amount), 0)) < 0.005

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={3}
          placeholder="Ask anything about this vehicle's accounting — e.g. “Explain my income statement,” “Does the GP entity reconcile to the fund?”, “Draft the entry to buy Apogee for $3.75M funded by the loan,” or “Review my books.”"
          className="w-full border border-input rounded p-2 text-sm bg-transparent"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => run()} disabled={loading || message.trim().length < 3}>
            {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}Ask
          </Button>
          <Button size="sm" variant="outline" onClick={() => run('Review these books and flag anything that looks wrong or incomplete.')} disabled={loading}>
            Review my books
          </Button>
        </div>
        {error && <p className="text-sm text-amber-600 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{error}</p>}
      </div>

      {result && (
        <div className="space-y-5">
          {result.summary && <p className="text-sm whitespace-pre-wrap">{result.summary}</p>}

          {result.findings.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Findings</p>
              {result.findings.map((f, i) => {
                const S = SEVERITY[f.severity] ?? SEVERITY.info
                const Icon = S.icon
                return (
                  <div key={i} className="border rounded-lg p-3 text-sm flex gap-2">
                    <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${S.cls}`} />
                    <div>
                      <p className="font-medium">{f.title}</p>
                      <p className="text-muted-foreground text-xs mt-0.5">{f.detail}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {result.proposals.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Proposed entries</p>
              {result.proposals.map((p, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {p.type === 'edit' ? 'Edit' : 'New'} · {p.entryDate} · {p.memo}
                    </p>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.sourceType ?? 'manual'}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground text-xs">
                        <th className="text-left font-medium py-1">Account</th>
                        <th className="text-right font-medium py-1">Debit</th>
                        <th className="text-right font-medium py-1">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.postings.map((x, j) => (
                        <tr key={j} className="border-t">
                          <td className="py-1 font-mono text-xs">{x.accountCode}</td>
                          <td className="py-1 text-right font-mono">{x.amount > 0 ? fmt(x.amount) : ''}</td>
                          <td className="py-1 text-right font-mono">{x.amount < 0 ? fmt(-x.amount) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-muted-foreground">{p.rationale}</p>
                  <div className="flex items-center gap-2">
                    {applied[i] ? (
                      <span className="text-sm text-green-600 flex items-center gap-1"><Check className="h-4 w-4" />Applied as a draft — review it in the Journal.</span>
                    ) : !balanced(p) ? (
                      <span className="text-sm text-amber-600 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />Doesn&apos;t balance — won&apos;t apply.</span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => apply(p, i)}>Apply as draft</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.findings.length === 0 && result.proposals.length === 0 && (
            <p className="text-sm text-muted-foreground">No findings or proposed entries.</p>
          )}
        </div>
      )}
    </div>
  )
}
