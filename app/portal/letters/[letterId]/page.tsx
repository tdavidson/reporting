'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, ArrowLeft, Download } from 'lucide-react'
import { AccessHistory } from '@/components/portal/access-history'

interface Letter {
  id: string
  period_label: string
  full_draft: string | null
  portfolio_table_html: string | null
}

export default function PortalLetterDetailPage() {
  const { letterId } = useParams<{ letterId: string }>()
  const [letter, setLetter] = useState<Letter | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    fetch(`/api/portal/letters/${letterId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then(body => setLetter(body.letter))
      .catch(() => setError('This letter is not available.'))
      .finally(() => setLoading(false))
  }, [letterId])

  async function downloadPdf() {
    if (!letter) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/portal/letters/${letter.id}/pdf`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${letter.period_label}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
  }
  if (error || !letter) {
    return (
      <div className="space-y-4">
        <Link href="/portal/snapshots" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back</Link>
        <div className="rounded-card border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error ?? 'Not found.'}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link href="/portal/snapshots" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back to documents</Link>

      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display text-heading font-normal">{letter.period_label}</h1>
        <button
          onClick={downloadPdf}
          disabled={downloading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-60"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download PDF
        </button>
      </div>

      <div className="rounded-card border bg-card p-6 space-y-4">
        {letter.full_draft && (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{letter.full_draft}</div>
        )}
        {letter.portfolio_table_html && (
          // GP-authored letter content, rendered as-is.
          <div className="text-sm overflow-x-auto [&_table]:w-full [&_th]:text-left [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_td]:border-t" dangerouslySetInnerHTML={{ __html: letter.portfolio_table_html }} />
        )}
        {!letter.full_draft && !letter.portfolio_table_html && (
          <p className="text-sm text-muted-foreground italic">This letter has no content.</p>
        )}
      </div>

      <div className="pt-2 border-t">
        <AccessHistory type="letter" id={letter.id} />
      </div>
    </div>
  )
}
