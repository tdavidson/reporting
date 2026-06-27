'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, FileText, Download } from 'lucide-react'

interface Doc {
  id: string
  title: string
  file_name: string
  size_bytes: number | null
  uploaded_at: string
  doc_date: string | null
  category: string | null
  scope: string
}

const SCOPE_ORDER: { key: string; label: string; hint: string }[] = [
  { key: 'fund', label: 'Fund documents', hint: 'Shared with all investors' },
  { key: 'investor', label: 'Your documents', hint: 'Specific to your account' },
]

function fmtSize(b: number | null): string {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function effective(d: Doc): string {
  return d.doc_date || d.uploaded_at || ''
}

function fmtDate(s: string): string {
  if (!s) return ''
  const date = new Date(s.length <= 10 ? `${s}T00:00:00` : s)
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PortalDocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/portal/documents')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(b => setDocs(b.documents ?? []))
      .catch(() => setError('Could not load your documents.'))
      .finally(() => setLoading(false))
  }, [])

  async function download(id: string) {
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

  // scope -> category -> docs (sorted by effective date, newest first)
  const grouped = useMemo(() => {
    const byScope = new Map<string, Map<string, Doc[]>>()
    for (const d of docs) {
      const s = d.scope === 'investor' ? 'investor' : 'fund'
      const cat = d.category?.trim() || 'Other'
      if (!byScope.has(s)) byScope.set(s, new Map())
      const catMap = byScope.get(s)!
      if (!catMap.has(cat)) catMap.set(cat, [])
      catMap.get(cat)!.push(d)
    }
    for (const catMap of Array.from(byScope.values())) {
      for (const arr of Array.from(catMap.values())) arr.sort((a, b) => effective(b).localeCompare(effective(a)))
    }
    return byScope
  }, [docs])

  const orderedCats = (catMap: Map<string, Doc[]>) =>
    Array.from(catMap.keys()).sort((a, b) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))

  const row = (d: Doc) => (
    <button key={d.id} onClick={() => download(d.id)} disabled={downloading === d.id} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{d.title}</div>
        <div className="text-xs text-muted-foreground truncate">
          {d.file_name}{d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ''}{effective(d) ? ` · ${fmtDate(effective(d))}` : ''}
        </div>
      </div>
      {downloading === d.id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" /> : <Download className="h-4 w-4 text-muted-foreground shrink-0" />}
    </button>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Files your fund has shared with you.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      ) : docs.length === 0 ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">No documents have been shared with you yet.</div>
      ) : (
        SCOPE_ORDER.map(scope => {
          const catMap = grouped.get(scope.key)
          if (!catMap || catMap.size === 0) return null
          const cats = orderedCats(catMap)
          const onlyOther = cats.length === 1 && cats[0] === 'Other'
          return (
            <section key={scope.key} className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold">{scope.label}</h2>
                <p className="text-xs text-muted-foreground">{scope.hint}</p>
              </div>
              {onlyOther ? (
                <div className="rounded-md border bg-card divide-y">{catMap.get('Other')!.map(row)}</div>
              ) : (
                cats.map(cat => (
                  <div key={cat} className="space-y-1.5">
                    {cat !== 'Other' && <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{cat}</h3>}
                    <div className="rounded-md border bg-card divide-y">{catMap.get(cat)!.map(row)}</div>
                  </div>
                ))
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
