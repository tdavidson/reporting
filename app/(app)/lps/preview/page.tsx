'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, FileText, Mail, Download, ArrowLeft, Eye, ExternalLink } from 'lucide-react'

interface Investor { id: string; name: string }
interface Snapshot { id: string; name: string; as_of_date: string | null }
interface Letter { id: string; period_label: string; period_year: number; period_quarter: number }
interface Doc { id: string; title: string; file_name: string; size_bytes: number | null; category: string | null; doc_date: string | null; uploaded_at: string; scope: string; sample: boolean }
interface Preview { investor: { id: string; name: string }; portal_enabled: boolean; snapshots: Snapshot[]; letters: Letter[]; documents: Doc[] }

const SCOPE_ORDER: { key: string; label: string }[] = [
  { key: 'fund', label: 'Fund documents' },
  { key: 'investor', label: 'Your documents' },
]

function fmtSize(b: number | null): string {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
function fmtDate(s: string | null): string {
  if (!s) return ''
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const effective = (d: Doc) => d.doc_date || d.uploaded_at || ''

export default function LpPortalPreviewPage() {
  const [investors, setInvestors] = useState<Investor[]>([])
  const [investorId, setInvestorId] = useState('')
  const [data, setData] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'snapshots' | 'letters' | 'documents'>('snapshots')
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/lps/investors')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setInvestors((Array.isArray(d) ? d : []).map((i: any) => ({ id: i.id, name: i.name }))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!investorId) { setData(null); return }
    setLoading(true)
    fetch(`/api/lps/preview?investor_id=${investorId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false))
  }, [investorId])

  async function download(id: string) {
    setDownloading(id)
    try {
      const r = await fetch(`/api/lps/preview/document/${id}`)
      if (r.ok) { const { url } = await r.json(); if (url) window.open(url, '_blank', 'noopener') }
    } finally { setDownloading(null) }
  }

  async function downloadReport(s: Snapshot) {
    setDownloading(s.id)
    try {
      const res = await fetch(`/api/lps/preview/snapshot/${s.id}/pdf?investor_id=${investorId}`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${s.name}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally { setDownloading(null) }
  }

  const groupedDocs = useMemo(() => {
    const byScope = new Map<string, Map<string, Doc[]>>()
    for (const d of (data?.documents ?? [])) {
      const s = d.scope === 'investor' ? 'investor' : 'fund'
      const cat = d.category?.trim() || 'Other'
      if (!byScope.has(s)) byScope.set(s, new Map())
      const cm = byScope.get(s)!
      if (!cm.has(cat)) cm.set(cat, [])
      cm.get(cat)!.push(d)
    }
    for (const cm of Array.from(byScope.values())) for (const arr of Array.from(cm.values())) arr.sort((a, b) => effective(b).localeCompare(effective(a)))
    return byScope
  }, [data])

  const orderedCats = (cm: Map<string, Doc[]>) => Array.from(cm.keys()).sort((a, b) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))

  const TABS = [
    { key: 'snapshots' as const, label: 'Reports', count: data?.snapshots.length ?? 0 },
    { key: 'letters' as const, label: 'Letters', count: data?.letters.length ?? 0 },
    { key: 'documents' as const, label: 'Documents', count: data?.documents.length ?? 0 },
  ]

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Admin preview bar — NOT part of the real portal an LP sees */}
      <div className="sticky top-0 z-20 border-b bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200">
        <div className="max-w-5xl mx-auto px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium"><Eye className="h-4 w-4" /> LP portal preview — viewing as</span>
          <select
            value={investorId}
            onChange={e => { setInvestorId(e.target.value); setTab('snapshots') }}
            className="h-7 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-amber-950 px-2 text-sm text-foreground"
          >
            <option value="">Select an LP…</option>
            {investors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {investorId && data && !data.portal_enabled && <span className="text-xs">Portal is OFF — LPs can’t see this yet</span>}
          <Link href="/lps" className="ml-auto inline-flex items-center gap-1 opacity-80 hover:opacity-100">
            <ArrowLeft className="h-3.5 w-3.5" /> Exit preview
          </Link>
        </div>
      </div>

      {/* Portal chrome — mirrors the real /portal layout */}
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4">
          <div className="py-3 font-semibold text-sm tracking-tight">Investor Portal</div>
          <nav className="flex items-center gap-4 -mb-px">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                disabled={!investorId}
                className={`text-sm py-2 border-b-2 disabled:opacity-40 ${tab === t.key ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                {t.label}{t.count > 0 ? <span className="ml-1 text-xs text-muted-foreground">{t.count}</span> : null}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {!investorId ? (
          <div className="text-sm text-muted-foreground">Select an LP in the bar above to see their portal exactly as they would.</div>
        ) : loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : !data ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Could not load preview.</div>
        ) : (
          <div className="space-y-4">
            {tab === 'snapshots' && (
              <>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">Your reports</h1>
                  <p className="text-sm text-muted-foreground mt-0.5">Statements your fund has shared with you. Select one to download a PDF.</p>
                </div>
                {data.snapshots.length === 0 ? <Empty label="No reports have been shared with you yet." /> : (
                  <div className="rounded-md border bg-card divide-y">
                    {data.snapshots.map(s => (
                      <button key={s.id} onClick={() => downloadReport(s)} disabled={downloading === s.id} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{s.name}</div>
                          {s.as_of_date && <div className="text-xs text-muted-foreground">As of {s.as_of_date}</div>}
                        </div>
                        {downloading === s.id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" /> : <Download className="h-4 w-4 text-muted-foreground shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'letters' && (
              <>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">Letters</h1>
                  <p className="text-sm text-muted-foreground mt-0.5">Quarterly updates your fund has shared with you.</p>
                </div>
                {data.letters.length === 0 ? <Empty label="No letters have been shared with you yet." /> : (
                  <div className="rounded-md border bg-card divide-y">
                    {data.letters.map(l => (
                      <Link key={l.id} href={`/letters/${l.id}`} target="_blank" className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                        <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0"><div className="font-medium text-sm truncate">{l.period_label}</div></div>
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'documents' && (
              <>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">Documents</h1>
                  <p className="text-sm text-muted-foreground mt-0.5">Files your fund has shared with you.</p>
                </div>
                {data.documents.length === 0 ? <Empty label="No documents have been shared with you yet." /> : (
                  <div className="space-y-5">
                    {SCOPE_ORDER.map(scope => {
                      const cm = groupedDocs.get(scope.key)
                      if (!cm || cm.size === 0) return null
                      const cats = orderedCats(cm)
                      const onlyOther = cats.length === 1 && cats[0] === 'Other'
                      return (
                        <section key={scope.key} className="space-y-2">
                          <h2 className="text-sm font-semibold">{scope.label}</h2>
                          {onlyOther ? (
                            <DocList docs={cm.get('Other')!} downloading={downloading} onDownload={download} />
                          ) : (
                            cats.map(cat => (
                              <div key={cat} className="space-y-1.5">
                                {cat !== 'Other' && <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{cat}</h3>}
                                <DocList docs={cm.get(cat)!} downloading={downloading} onDownload={download} />
                              </div>
                            ))
                          )}
                        </section>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">{label}</div>
}

function DocList({ docs, downloading, onDownload }: { docs: Doc[]; downloading: string | null; onDownload: (id: string) => void }) {
  return (
    <div className="rounded-md border bg-card divide-y">
      {docs.map(d => {
        const inner = (
          <>
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{d.title}</div>
              <div className="text-xs text-muted-foreground truncate">{d.file_name}{d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ''}{effective(d) ? ` · ${fmtDate(effective(d))}` : ''}</div>
            </div>
          </>
        )
        return d.sample ? (
          <div key={d.id} className="w-full flex items-center gap-3 px-4 py-3" title="Sample document">
            {inner}
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">Sample</span>
          </div>
        ) : (
          <button key={d.id} onClick={() => onDownload(d.id)} disabled={downloading === d.id} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
            {inner}
            {downloading === d.id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" /> : <Download className="h-4 w-4 text-muted-foreground shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}
