'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Check, AlertTriangle, Lock, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChecklistBar, DataRoomBar, StageBar } from './progress-bars'
import type { StageInfo, StageKey, ChecklistStatus, DocBucket } from '@/lib/diligence/progress'

export interface DiligenceProgress {
  stages: StageInfo[]
  checklist: { counts: Record<ChecklistStatus, number>; total: number }
  data_room: { counts: Record<DocBucket, number>; total: number }
  checklist_assessed: number
}
interface Job {
  id: string
  kind: string
  status: string
  progress_message: string | null
  error: string | null
  started_at: string | null
  enqueued_at: string | null
  finished_at: string | null
}
interface StatusResponse {
  latest_job: Job | null
  progress: DiligenceProgress
}

/**
 * The deal's progress, polled while a job is in flight. Every stage header and the
 * master bar read from this one endpoint, so they can't disagree about what's done.
 */
export function useDiligenceProgress(dealId: string) {
  const [data, setData] = useState<StatusResponse | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/diligence/${dealId}/agent/status`)
      if (res.ok) setData(await res.json())
    } catch { /* ignore */ }
  }, [dealId])

  useEffect(() => { refresh() }, [refresh])

  const job = data?.latest_job
  const inFlight = !!job && (job.status === 'pending' || job.status === 'running')

  useEffect(() => {
    if (!inFlight) return
    const id = setInterval(refresh, 5_000)
    return () => clearInterval(id)
  }, [inFlight, refresh])

  return { data, progress: data?.progress ?? null, job: job ?? null, inFlight, refresh }
}

/**
 * The header that goes at the TOP of each pipeline tab: what this stage does, the
 * button that runs it, and how the last run went.
 *
 * The point is that the action now lives where its output does. Before this, "Analyze
 * data room" was on the Checklist tab, "Run research" was buried in a section on the
 * Diligence tab, and the checklist assessment had no button at all — you could only
 * reach it through a failure banner.
 */
export function StageHeader({
  dealId,
  stageKey,
  onRan,
  children,
}: {
  dealId: string
  stageKey: StageKey
  onRan?: () => void
  children?: React.ReactNode
}) {
  const { progress, job, refresh } = useDiligenceProgress(dealId)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stage = progress?.stages.find(s => s.key === stageKey) ?? null
  if (!stage) return null

  const running = stage.state === 'running'
  const blocked = stage.state === 'blocked'

  async function run() {
    if (!stage?.action) return
    setSubmitting(true); setError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/agent/${stage.action}`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Could not start')
      } else {
        await refresh()
        onRan?.()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const Icon = stage.state === 'done' ? Check
    : stage.state === 'failed' ? AlertTriangle
    : blocked ? Lock
    : null

  return (
    <div className="mb-4 rounded-card border p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium flex items-center gap-1.5">
            {Icon && <Icon className={`h-3.5 w-3.5 ${stage.state === 'done' ? 'text-success' : stage.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`} />}
            {stage.label}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{stage.hint}</p>
        </div>

        {stage.action && (
          // Outline regardless of state — every other run button on these tabs is an
          // outline button, and a primary-filled one here just made the stage that
          // happened to be next look louder than the rest of the page.
          <Button
            size="sm"
            variant="outline"
            onClick={run}
            disabled={submitting || running || blocked}
            title={blocked ? stage.hint : undefined}
          >
            {(submitting || running)
              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <Play className="h-3.5 w-3.5 mr-1" />}
            {running ? 'Running…' : stage.actionLabel}
          </Button>
        )}
      </div>

      {/* The bar belongs with the stage it measures. */}
      {stageKey === 'checklist' && progress && (
        <ChecklistBar counts={progress.checklist.counts} total={progress.checklist.total} />
      )}
      {stageKey === 'data_room' && progress && (
        <DataRoomBar counts={progress.data_room.counts} total={progress.data_room.total} />
      )}

      {children}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {job && job.kind && stage.state !== 'blocked' && <JobLine job={job} stage={stage} />}
    </div>
  )
}

function JobLine({ job, stage }: { job: Job; stage: StageInfo }) {
  const [, tick] = useState(0)
  const live = job.status === 'pending' || job.status === 'running'
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [live, job.id])

  if (stage.state === 'running') {
    const from = job.started_at ?? job.enqueued_at
    const secs = from ? Math.round((Date.now() - new Date(from).getTime()) / 1000) : 0
    const mins = Math.floor(secs / 60)
    const elapsed = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`
    return (
      <div className="rounded-md border bg-muted/30 p-2 text-xs flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        <span className="flex-1">
          {job.status === 'pending' ? 'Queued — the worker picks up within about a minute.' : (job.progress_message ?? 'Running…')}
        </span>
        <span className="tabular-nums text-muted-foreground">{elapsed} {job.started_at ? 'running' : 'queued'}</span>
      </div>
    )
  }

  if (stage.state === 'failed' && job.error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
        <p className="font-medium text-destructive">Last run failed.</p>
        <p className="text-destructive/80 mt-0.5">{job.error}</p>
      </div>
    )
  }

  if (stage.state === 'done' && job.finished_at) {
    return (
      <p className="text-xs text-muted-foreground">
        <Check className="h-3 w-3 inline mr-1" />
        Last run finished {new Date(job.finished_at).toLocaleString()}.
      </p>
    )
  }

  return null
}

/** The master pipeline bar, for the top of the deal page. */
export function DiligenceStageBar({ dealId, onJump }: { dealId: string; onJump?: (tab: string) => void }) {
  const { progress } = useDiligenceProgress(dealId)
  if (!progress) return null
  return (
    <div className="mb-4 rounded-card border p-3">
      <StageBar stages={progress.stages} onJump={onJump} />
    </div>
  )
}
