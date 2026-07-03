'use client'

import { useState } from 'react'
import { Loader2, Check, AlertTriangle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface DraftPosting { accountId: string; amount: number; currency: string; lpEntityId: string | null }
interface Draft { entryDate: string; memo: string | null; sourceType: string; postings: DraftPosting[] }
interface Result { draft: Draft; balanced: boolean; imbalance: Record<string, number>; unknownCodes: string[]; savedEntryId: string | null }

export function DraftEntryView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyFull(v, currency)
  const [text, setText] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pdfBase64, setPdfBase64] = useState<string | null>(null)
  const [pdfName, setPdfName] = useState<string | null>(null)
  const lf = useLedgerFetch()

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (/\.pdf$/i.test(file.name)) {
      const buf = await file.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      setPdfBase64(btoa(binary)); setPdfName(file.name)
    } else {
      setText(await file.text()); setPdfBase64(null); setPdfName(null)
    }
    e.target.value = ''
  }

  async function draft(post: boolean) {
    setBusy(true); setError(null); if (!post) setSaved(false)
    const res = await lf('/api/accounting/draft-entry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, pdfBase64, post }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setBusy(false); return }
    setResult(data)
    if (post && data.savedEntryId) setSaved(true)
    setBusy(false)
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={8}
        placeholder="Paste a capital-call notice, invoice, wire confirmation, or distribution notice…"
        className="w-full border border-input rounded p-2 text-sm font-mono bg-transparent"
      />
      <div className="flex items-center gap-2">
        <Button onClick={() => draft(false)} disabled={busy || (text.trim().length < 10 && !pdfBase64)}>
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Draft entry
        </Button>
        <label className="text-xs text-muted-foreground cursor-pointer border rounded px-2 py-1.5 hover:bg-accent">
          {pdfName ? pdfName : 'Upload PDF / text'}
          <input type="file" accept=".pdf,.txt,.md" onChange={onFile} className="hidden" />
        </label>
        {result?.balanced && (
          <Button variant="outline" onClick={() => draft(true)} disabled={busy}>Save as draft entry</Button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-600 flex items-center gap-1"><Check className="h-4 w-4" />Saved as a draft in the Journal for review.</p>}

      {result && (
        <div className="border rounded-lg overflow-hidden">
          <div className={`px-3 py-2 text-sm flex items-center gap-2 ${result.balanced ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
            {result.balanced ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {result.balanced ? 'Balanced' : 'Does not balance — review before posting'}
            <span className="text-muted-foreground">· {result.draft.sourceType} · {result.draft.entryDate}</span>
          </div>
          {result.unknownCodes.length > 0 && (
            <p className="px-3 py-1.5 text-xs text-amber-600">Unknown account codes: {result.unknownCodes.join(', ')}</p>
          )}
          <table className="w-full text-sm">
            <tbody>
              {result.draft.postings.map((p, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.lpEntityId ? `LP ${p.lpEntityId.slice(0, 8)}` : p.accountId.slice(0, 8)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{p.amount >= 0 ? fmt(p.amount) : ''}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{p.amount < 0 ? fmt(-p.amount) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.draft.memo && <p className="px-3 py-1.5 text-xs text-muted-foreground border-t">{result.draft.memo}</p>}
        </div>
      )}
    </div>
  )
}
