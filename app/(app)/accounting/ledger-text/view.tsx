'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface PostResult { posted: number; errors: string[]; unknownAccounts: string[] }

export function LedgerTextView() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [result, setResult] = useState<PostResult | null>(null)
  const lf = useLedgerFetch()

  function load() {
    setLoading(true)
    lf('/api/accounting/ledger-text')
      .then(r => (r.ok ? r.json() : { text: '' }))
      .then(d => setText(d.text ?? ''))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [lf]) // eslint-disable-line react-hooks/exhaustive-deps

  async function post() {
    setPosting(true); setResult(null)
    const res = await lf('/api/accounting/ledger-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    const data = await res.json()
    setResult(res.ok ? data : { posted: 0, errors: [data.error ?? 'Failed'], unknownAccounts: [] })
    setPosting(false)
  }

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Author entries as plain-text double-entry. Reference accounts by name
        (<code>Assets:Cash:1000</code>) or by chart code. Each entry must balance; one posting per
        entry may omit its amount and be inferred. <code>*</code> posts, <code>!</code> saves a draft.
      </p>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={20}
        spellCheck={false}
        className="w-full border border-input rounded p-3 text-xs font-mono bg-transparent leading-relaxed"
      />

      <div className="flex items-center gap-2">
        <Button onClick={post} disabled={posting || text.trim().length < 10}>
          {posting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Post from text
        </Button>
        <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Reload</Button>
        {result && (
          <span className={`text-sm flex items-center gap-1 ${result.errors.length || result.unknownAccounts.length ? 'text-amber-600' : 'text-green-600'}`}>
            {result.errors.length || result.unknownAccounts.length ? <AlertTriangle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {result.posted} posted{result.unknownAccounts.length ? `, ${result.unknownAccounts.length} unknown account(s)` : ''}{result.errors.length ? `, ${result.errors.length} error(s)` : ''}.
          </span>
        )}
      </div>

      {result && (result.errors.length > 0 || result.unknownAccounts.length > 0) && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {result.unknownAccounts.map((a, i) => <div key={`u${i}`}>Unknown account: <code>{a}</code></div>)}
          {result.errors.map((e, i) => <div key={`e${i}`}>{e}</div>)}
        </div>
      )}
    </div>
  )
}
