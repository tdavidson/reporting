'use client'

import { Loader2, Check, AlertTriangle, Lock } from 'lucide-react'
import {
  CHECKLIST_STATUSES, CHECKLIST_LABEL, CHECKLIST_COLOR,
  DOC_LABEL, DOC_COLOR,
  type ChecklistStatus, type DocBucket, type StageInfo,
} from '@/lib/diligence/progress'

// ---------------------------------------------------------------------------
// SegmentedBar — a COMPOSITION bar. Segment widths are proportional to counts.
// Used for the checklist (items by status) and the data room (docs by parse state).
// ---------------------------------------------------------------------------

export interface Segment { key: string; label: string; count: number; color: string }

export function SegmentedBar({
  segments,
  total,
  emptyLabel = 'Nothing yet',
}: {
  segments: Segment[]
  total: number
  emptyLabel?: string
}) {
  const shown = segments.filter(s => s.count > 0)

  if (total === 0) {
    return (
      <div className="space-y-1.5">
        <div className="h-2 w-full rounded-full bg-muted" />
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {shown.map(s => (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${(s.count / total) * 100}%` }}
            title={`${s.label}: ${s.count} of ${total}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {shown.map(s => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.color}`} />
            {s.count} {s.label.toLowerCase()}
          </span>
        ))}
        <span className="text-muted-foreground/60">· {total} total</span>
      </div>
    </div>
  )
}

export function ChecklistBar({ counts, total }: { counts: Record<ChecklistStatus, number>; total: number }) {
  return (
    <SegmentedBar
      total={total}
      emptyLabel="No checklist items yet."
      segments={CHECKLIST_STATUSES.map(s => ({
        key: s,
        label: CHECKLIST_LABEL[s],
        count: counts[s] ?? 0,
        color: CHECKLIST_COLOR[s],
      }))}
    />
  )
}

const DOC_ORDER: DocBucket[] = ['processed', 'partial', 'failed', 'pending', 'skipped']

export function DataRoomBar({ counts, total }: { counts: Record<DocBucket, number>; total: number }) {
  return (
    <SegmentedBar
      total={total}
      emptyLabel="No documents uploaded yet."
      segments={DOC_ORDER.map(b => ({
        key: b,
        label: DOC_LABEL[b],
        count: counts[b] ?? 0,
        color: DOC_COLOR[b],
      }))}
    />
  )
}

// ---------------------------------------------------------------------------
// StageBar — a SEQUENCE bar, deliberately NOT proportional.
//
// The stages aren't equal-sized units of work, so sizing them by "share of the
// pipeline" would imply a precision that doesn't exist. Equal segments, coloured by
// state, is the honest rendering: it answers "what's done and what's next", which is
// the actual question.
// ---------------------------------------------------------------------------

// Each segment is a TRACK with a FILL sized to `stage.progress`, so a stage that's
// under way reads as under way rather than as not-started. Colour carries the state
// (amber = in progress, emerald = finished); width carries how far in it is. A stage
// that isn't done is capped below 100% fill upstream, so amber can never look full.
const STATE_STYLE: Record<StageInfo['state'], { fill: string; text: string; Icon: typeof Check | null }> = {
  done:    { fill: 'bg-success',           text: 'text-foreground',          Icon: Check },
  partial: { fill: 'bg-warning',             text: 'text-foreground',          Icon: null },
  running: { fill: 'bg-primary animate-pulse', text: 'text-foreground',          Icon: Loader2 },
  failed:  { fill: 'bg-destructive',               text: 'text-destructive',             Icon: AlertTriangle },
  blocked: { fill: 'bg-transparent',           text: 'text-muted-foreground/60', Icon: Lock },
  todo:    { fill: 'bg-transparent',           text: 'text-muted-foreground',    Icon: null },
}

export function StageBar({
  stages,
  onJump,
}: {
  stages: StageInfo[]
  onJump?: (tab: string) => void
}) {
  const done = stages.filter(s => s.state === 'done').length
  const running = stages.find(s => s.state === 'running')

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {done} of {stages.length} stages complete
        </p>
        {running && (
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            Running {running.label.toLowerCase()}…
          </p>
        )}
      </div>

      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map(s => {
          const st = STATE_STYLE[s.state]
          const Icon = st.Icon
          const pct = Math.round(s.progress * 100)
          // A running stage with no measurable sub-progress still needs to look alive.
          const width = s.state === 'running' && pct === 0 ? 100 : pct
          return (
            <button
              key={s.key}
              type="button"
              onClick={onJump ? () => onJump(s.tab) : undefined}
              disabled={!onJump}
              title={s.state === 'partial' ? `${s.label}: ${pct}% — ${s.hint}` : s.hint}
              className="group text-left disabled:cursor-default"
            >
              <div className={`h-1.5 w-full overflow-hidden rounded-full ${s.state === 'blocked' ? 'bg-muted-foreground/10' : 'bg-muted-foreground/20'}`}>
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${st.fill}`}
                  style={{ width: `${width}%` }}
                />
              </div>
              <span className={`mt-1.5 flex items-center gap-1 text-[11px] leading-tight ${st.text} ${onJump ? 'group-hover:text-foreground' : ''}`}>
                {Icon && <Icon className={`h-3 w-3 shrink-0 ${s.state === 'running' ? 'animate-spin' : ''}`} />}
                <span className="truncate">{s.label}</span>
                {s.state === 'partial' && (
                  <span className="shrink-0 tabular-nums text-warning">{pct}%</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
