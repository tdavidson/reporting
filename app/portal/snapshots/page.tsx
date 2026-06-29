'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, FileText, Download, Mail, ChevronRight } from 'lucide-react'
import { LpAnalyst } from '@/components/portal/lp-analyst'

interface Snapshot { id: string; name: string; as_of_date: string | null }
interface Letter { id: string; period_label: string }
interface Doc {
  id: string; title: string; file_name: string; size_bytes: number | null
  uploaded_at: string; doc_date: string | null; category: string | null; scope: string; sample: boolean
}

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
const effective = (d: Doc) => d.doc_date || d.uploaded_at || ''
function fmtDate(s: string): string {
  if (!s) return ''
  const date = new Date(s.length <= 10 ? `${s}T00:00:00` : s)
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export default function PortalLibraryPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [letters, setLetters] = useState<Letter[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/portal/snapshots').then(r => (r.ok ? r.json() : { snapshots: [] })),
      fetch('/api/portal/letters').then(r => (r.ok ? r.json() : { letters: [] })),
      fetch('/api/portal/documents').then(r => (r.ok ? r.json() : { documents: [] })),
    ])
      .then(([s, l, d]) => {
        setSnapshots(s.snapshots ?? [])
        setLetters(l.letters ?? [])
        setDocs(d.documents ?? [])
      })
      .catch(() => setError('Could not load your documents.'))
      .finally(() => setLoading(false))
  }, [])

  async function downloadReport(s: Snapshot) {
    setDownloading(s.id)
    try {
      const res = await fetch(`/api/portal/snapshots/${s.id}/pdf`)
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
    } finally {
      setDownloading(null)
    }
  }

  async function downloadDoc(id: string) {
    setDownloading(id)
    try {
      const res = await fetch(`/api/portal/documents/${id}`)
      if (res.ok) {
        const { url } = await res.json()
        if (url) window.open(url, '_blank', 'noopener')
      }
    } finally {
      setDownloading(null)
    }
  }

  // scope -> docs (flat, newest first); category is shown inline on each row.
  const groupedDocs = useMemo(() => {
    const byScope = new Map<string, Doc[]>()
    for (const d of docs) {
      const s = d.scope === 'investor' ? 'investor' : 'fund'
      if (!byScope.has(s)) byScope.set(s, [])
      byScope.get(s)!.push(d)
    }
    for (const arr of Array.from(byScope.values())) arr.sort((a, b) => effective(b).localeCompare(effective(a)))
    return byScope
  }, [docs])

  const docRow = (d: Doc) => {
    const meta = [d.category?.trim(), d.file_name, d.size_bytes ? fmtSize(d.size_bytes) : null, effective(d) ? fmtDate(effective(d)) : null].filter(Boolean).join(' · ')
    const inner = (
      <>
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{d.title}</div>
          {meta && <div className="text-xs text-muted-foreground truncate">{meta}</div>}
        </div>
      </>
    )
    return d.sample ? (
      <div key={d.id} className="w-full flex items-center gap-3 px-4 py-3" title="Sample document">
        {inner}
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">Sample</span>
      </div>
    ) : (
      <button key={d.id} onClick={() => downloadDoc(d.id)} disabled={downloading === d.id} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
        {inner}
        {downloading === d.id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" /> : <Download className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
    )
  }

  const isEmpty = snapshots.length === 0 && letters.length === 0 && docs.length === 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Your documents</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Reports, letters, and documents your fund has shared with you.</p>
        </div>
        <LpAnalyst />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      ) : isEmpty ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">Nothing has been shared with you yet.</div>
      ) : (
        <>
          {snapshots.length > 0 && (
            <Section title="Statements">
              <div className="rounded-md border bg-card divide-y">
                {snapshots.map(s => (
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
            </Section>
          )}

          {letters.length > 0 && (
            <Section title="Letters">
              <div className="rounded-md border bg-card divide-y">
                {letters.map(l => (
                  <Link key={l.id} href={`/portal/letters/${l.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0"><div className="font-medium text-sm truncate">{l.period_label}</div></div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {docs.length > 0 && (
            <Section title="Documents">
              <div className="space-y-4">
                {SCOPE_ORDER.map(scope => {
                  const list = groupedDocs.get(scope.key)
                  if (!list || list.length === 0) return null
                  return (
                    <div key={scope.key} className="space-y-1.5">
                      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{scope.label}</h3>
                      <div className="rounded-md border bg-card divide-y">{list.map(docRow)}</div>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
