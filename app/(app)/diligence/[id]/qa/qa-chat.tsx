'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Send, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BatchItem {
  question_id: string
  prompt: string
  rationale: string
  category: string
  intent: string
  sensitivity: 'standard' | 'high'
}

interface CoveredItem {
  question_id: string
  covered_by: 'ingestion' | 'research' | 'prior_answer'
  evidence: string
}

interface SessionState {
  session_id: string
  draft_id: string
  asked_ids: string[]
  answers: Record<string, { answer_text: string; partner_id: string | null; answered_at: string }>
  pending_question_ids: string[]
  total_questions: number
}

interface BatchResponse {
  session_id: string
  draft_id: string
  batch: BatchItem[]
  covered: CoveredItem[]
  total_remaining: number
  state: SessionState
}

export function QAChat({ dealId, dealName }: { dealId: string; dealName: string }) {
  const router = useRouter()
  const [state, setState] = useState<SessionState | null>(null)
  const [batch, setBatch] = useState<BatchItem[]>([])
  const [covered, setCovered] = useState<CoveredItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalRemaining, setTotalRemaining] = useState<number | null>(null)

  async function fetchNextBatch() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/agent/qa/next-batch`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to fetch next batch')
      }
      const body: BatchResponse = await res.json()
      setState(body.state)
      setBatch(body.batch)
      setCovered(body.covered)
      setTotalRemaining(body.total_remaining)
      const d: Record<string, string> = {}
      for (const item of body.batch) d[item.question_id] = ''
      setDrafts(d)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchNextBatch() }, [dealId])

  async function submitAnswers() {
    if (!state) return
    const answers = Object.entries(drafts)
      .map(([qid, text]) => ({ question_id: qid, answer_text: text.trim() }))
      .filter(a => a.answer_text.length > 0)
    if (answers.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/agent/qa/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: state.session_id, answers }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to record answers')
      }
      // Fetch the next batch automatically.
      await fetchNextBatch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function finish() {
    if (!state) return
    setFinishing(true)
    setError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/agent/qa/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: state.session_id, draft_id: state.draft_id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to finish Q&A')
      }
      setFinished(true)
      setTimeout(() => router.push(`/diligence/${dealId}`), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setFinishing(false)
    }
  }

  const answeredCount = state ? Object.keys(state.answers).length : 0

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 max-w-4xl">
      <Link href={`/diligence/${dealId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to deal
      </Link>

      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stage 3 — Partner Q&amp;A</h1>
          <p className="text-sm text-muted-foreground mt-1">{dealName}</p>
        </div>
        <div className="text-xs text-muted-foreground text-right shrink-0">
          {answeredCount} answered{totalRemaining !== null ? ` · ~${totalRemaining} remaining` : ''}
        </div>
      </div>

      {finished && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-900/10 p-4 mb-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 inline mr-2" />
          Q&amp;A complete. Returning to the deal…
        </div>
      )}

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive mb-4">{error}</div>}

      {covered.length > 0 && (
        <div className="rounded-md border bg-muted/20 p-3 mb-4 text-xs space-y-1">
          <div className="font-medium text-muted-foreground">Skipped — already covered</div>
          {covered.map(c => (
            <div key={c.question_id}>
              <span className="font-mono">{c.question_id}</span> ({c.covered_by}): {c.evidence}
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="rounded-md border bg-card p-12 text-center text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
          Fetching next batch of questions…
        </div>
      )}

      {!loading && batch.length === 0 && !finished && (
        <div className="rounded-md border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            No more questions to ask. {answeredCount > 0 ? 'Finish the Q&A to write answers to the draft.' : 'You can finish without answers if needed.'}
          </p>
          <Button variant="outline" onClick={finish} disabled={finishing}>
            {finishing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Finish Q&amp;A
          </Button>
        </div>
      )}

      {!loading && batch.length > 0 && (
        <div className="space-y-3">
          {batch.map(item => (
            <div key={item.question_id} className="rounded-md border bg-card p-4">
              <div className="flex items-start gap-2 mb-2">
                <span className="font-mono text-[10px] text-muted-foreground mt-1">{item.question_id}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{item.prompt}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    <span className="capitalize">{item.category.replace(/_/g, ' ')}</span>
                    {item.sensitivity === 'high' && <span className="ml-2 text-amber-600">· high sensitivity</span>}
                  </p>
                  {item.rationale && (
                    <p className="text-[11px] text-muted-foreground italic mt-0.5">Why now: {item.rationale}</p>
                  )}
                </div>
              </div>
              <textarea
                value={drafts[item.question_id] ?? ''}
                onChange={e => setDrafts(prev => ({ ...prev, [item.question_id]: e.target.value }))}
                rows={3}
                className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Your answer (leave empty to skip)"
              />
            </div>
          ))}

          <div className="flex justify-between items-center">
            <Button variant="outline" size="sm" onClick={finish} disabled={finishing || submitting}>
              {finishing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Finish without next batch
            </Button>
            <Button variant="outline" onClick={submitAnswers} disabled={submitting || finishing}>
              {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              Submit & next batch
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
