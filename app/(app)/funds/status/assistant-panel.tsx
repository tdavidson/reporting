'use client'

import { useState } from 'react'
import { Loader2, Sparkles, AlertTriangle, Info, Check, Ban, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface ProposalPosting { accountCode: string; amount: number; lpEntity?: string | null }
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

export function AssistantPanel() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()

  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<Record<number, string>>({})
  const [docName, setDocName] = useState<string | null>(null)
  const [docText, setDocText] = useState<string | null>(null)
  const [pdfBase64, setPdfBase64] = useState<string | null>(null)

  // A PDF goes up as base64 and is extracted server-side; text files are read here.
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    if (/\.pdf$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      setPdfBase64(btoa(binary)); setDocText(null)
    } else {
      setDocText(await file.text()); setPdfBase64(null)
    }
    setDocName(file.name)
    e.target.value = ''
  }

  function clearDoc() { setDocName(null); setDocText(null); setPdfBase64(null) }

  const hasDoc = !!(docText || pdfBase64)

  async function run(prompt?: string) {
    const msg = prompt ?? message
    setLoading(true); setError(null); setResult(null); setApplied({})
    const res = await lf('/api/accounting/assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ask', message: msg, documentText: docText, pdfBase64 }),
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
          placeholder="Ask anything about this vehicle's accounting — e.g. “Explain my income statement,” “Does the GP entity reconcile to the fund?”, “Draft the entry to buy Apogee for $3.75M funded by the loan,” or “Review my books.” Or attach a capital-call notice, invoice, or wire confirmation and I'll draft the entry from it."
          className="w-full border border-input rounded p-2 text-sm bg-transparent"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={() => run()} disabled={loading || (message.trim().length < 3 && !hasDoc)}>
            {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}Ask
          </Button>
          <Button size="sm" variant="outline" onClick={() => run('Review these books and flag anything that looks wrong or incomplete.')} disabled={loading}>
            Review my books
          </Button>
          {docName ? (
            <span className="inline-flex items-center gap-1.5 text-xs border rounded px-2 py-1.5 bg-accent/50">
              <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
              {docName}
              <button onClick={clearDoc} className="text-muted-foreground hover:text-foreground" aria-label="Remove document">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer border rounded px-2 py-1.5 hover:bg-accent">
              <Paperclip className="h-3.5 w-3.5" />
              Attach document
              <input type="file" accept=".pdf,.txt,.md" onChange={onFile} className="hidden" />
            </label>
          )}
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
                          <td className="py-1 text-xs">
                            <span className="font-mono">{x.accountCode}</span>
                            {x.lpEntity && <span className="ml-1.5 text-muted-foreground">· {x.lpEntity}</span>}
                          </td>
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
