'use client'

import { useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

type Action = 'management_fee' | 'expense' | 'gain' | 'revalue' | 'close_period'

const ACTION_LABELS: Record<Action, string> = {
  management_fee: 'Management fee',
  expense: 'Partnership expense',
  gain: 'Realized gain',
  revalue: 'Revalue investment',
  close_period: 'Close period',
}

interface PreviewPosting { accountId: string; amount: number; lpEntityId: string | null }
interface Preview { entryDate: string; sourceType: string; postings: PreviewPosting[] }

export function AllocationsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyFull(v, currency)
  const [action, setAction] = useState<Action>('management_fee')
  const [entryDate, setEntryDate] = useState('')
  const [annualRate, setAnnualRate] = useState('2')
  const [periodFraction, setPeriodFraction] = useState('0.25')
  const [amount, setAmount] = useState('')
  const [fairValue, setFairValue] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [posted, setPosted] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lf = useLedgerFetch()

  function payload(post: boolean) {
    const b: any = { action, entryDate, post }
    if (action === 'management_fee') {
      b.annualRate = parseFloat(annualRate) / 100
      b.periodFraction = parseFloat(periodFraction)
    } else if (action === 'expense' || action === 'gain') {
      b.amount = parseFloat(amount)
    } else if (action === 'revalue') {
      b.fairValue = parseFloat(fairValue)
    }
    return b
  }

  async function run(post: boolean) {
    setBusy(true); setError(null); setPosted(null)
    const res = await lf('/api/accounting/allocations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload(post)),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setBusy(false); return }
    if (post) { setPosted(data.entryId); setPreview(null) }
    else setPreview(data.preview)
    setBusy(false)
  }

  const debits = preview?.postings.filter(p => p.amount > 0) ?? []
  const total = debits.reduce((s, p) => s + p.amount, 0)

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(ACTION_LABELS) as Action[]).map(a => (
          <button key={a} onClick={() => { setAction(a); setPreview(null) }}
            className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${action === a ? 'border-foreground/30 bg-accent font-medium' : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {ACTION_LABELS[a]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Entry date</label>
          <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-full" />
        </div>
        {action === 'management_fee' && (
          <>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Annual rate (%)</label>
              <input type="number" step="0.01" value={annualRate} onChange={e => setAnnualRate(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-full font-mono" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Period fraction (0.25 = quarter)</label>
              <input type="number" step="0.01" value={periodFraction} onChange={e => setPeriodFraction(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-full font-mono" />
            </div>
          </>
        )}
        {(action === 'expense' || action === 'gain') && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Amount</label>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-full font-mono" />
          </div>
        )}
        {action === 'revalue' && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">New fair value</label>
            <input type="number" step="0.01" value={fairValue} onChange={e => setFairValue(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-full font-mono" />
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {action === 'management_fee' && 'Charged on committed capital, allocated per LP (side letters/exemptions supported via the API). Booked to the expense account and each LP’s capital via the undistributed-earnings bridge.'}
        {action === 'expense' && 'Allocated pro-rata by commitment; booked to the expense account and each LP’s capital via the bridge.'}
        {action === 'gain' && 'Allocated pro-rata by commitment; increases each LP’s capital and books income via the bridge.'}
        {action === 'revalue' && 'Marks the investment to a new fair value; the unrealized change is allocated per LP and moves NAV.'}
        {action === 'close_period' && 'Zeroes every income/expense account into the undistributed-earnings bridge, closing the period. Capital accounts are already current.'}
      </p>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => run(false)} disabled={busy || !entryDate}>
          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Preview
        </Button>
        <Button onClick={() => run(true)} disabled={busy || !entryDate}>Post entry</Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {posted && (
        <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
          <Check className="h-4 w-4" />Posted. See it in Journal and Capital accounts.
        </div>
      )}

      {preview && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-muted/40 text-sm font-medium">Preview · {preview.sourceType} · total {fmt(total)}</div>
          <table className="w-full text-sm">
            <tbody>
              {preview.postings.map((p, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.lpEntityId ? `LP ${p.lpEntityId.slice(0, 8)}` : 'Fund'}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{p.amount >= 0 ? fmt(p.amount) : ''}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{p.amount < 0 ? fmt(-p.amount) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
