// One model of "where is this deal in the process".
//
// WHY NOT `diligence_deals.current_memo_stage`: it's a POINTER, not a completion
// record. It only moves forward, and it lies — the ingest route sets it to
// `research` the moment ingestion is enqueued, long before research has run. So a
// "what's done" view built on it would show stages complete that never happened.
//
// Completion is instead derived from artefacts that only exist if the work actually
// finished: the draft's output columns, the checklist's assessed statuses, the
// documents' parse_status. Those can't lie.

export type StageKey = 'data_room' | 'checklist' | 'research' | 'scoring' | 'memo'
export type StageState = 'done' | 'partial' | 'running' | 'failed' | 'blocked' | 'todo'

export interface StageInfo {
  key: StageKey
  label: string
  state: StageState
  /**
   * How far through the stage the deal is, 0–1. Only ever 1 when `state` is
   * 'done', so a bar can never render full while work remains.
   */
  progress: number
  /** Which tab the work lives on. */
  tab: string
  /** The agent endpoint that runs it, if it can be triggered directly. */
  action: string | null
  actionLabel: string
  /** Why it's blocked, or what it does. */
  hint: string
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export const CHECKLIST_STATUSES = ['found', 'partial', 'missing', 'unknown', 'not_applicable'] as const
export type ChecklistStatus = typeof CHECKLIST_STATUSES[number]

export const CHECKLIST_LABEL: Record<ChecklistStatus, string> = {
  found: 'Found',
  partial: 'Partial',
  missing: 'Missing',
  unknown: 'Not assessed',
  not_applicable: 'N/A',
}

/** Tailwind fill classes. One palette across every bar so a colour means one thing. */
export const CHECKLIST_COLOR: Record<ChecklistStatus, string> = {
  found: 'bg-emerald-500',
  partial: 'bg-amber-500',
  missing: 'bg-red-500',
  unknown: 'bg-muted-foreground/25',
  not_applicable: 'bg-muted-foreground/10',
}

// ---------------------------------------------------------------------------
// Data room
// ---------------------------------------------------------------------------

export type DocBucket = 'processed' | 'partial' | 'failed' | 'pending' | 'skipped'

export const DOC_LABEL: Record<DocBucket, string> = {
  processed: 'Processed',
  partial: 'Partially parsed',
  failed: 'Failed',
  pending: 'Not processed',
  skipped: 'Skipped',
}

export const DOC_COLOR: Record<DocBucket, string> = {
  processed: 'bg-emerald-500',
  partial: 'bg-amber-500',
  failed: 'bg-red-500',
  pending: 'bg-muted-foreground/25',
  skipped: 'bg-muted-foreground/10',
}

/** `parse_status` is free text with no CHECK constraint, so map defensively. */
export function docBucket(parseStatus: string | null | undefined): DocBucket {
  switch (parseStatus) {
    case 'parsed':
    case 'transcribed':
      return 'processed'
    case 'partial':
      return 'partial'
    case 'failed':
      return 'failed'
    case 'skipped':
      return 'skipped'
    default:
      return 'pending'
  }
}

export interface Counts<K extends string> {
  counts: Record<K, number>
  total: number
}

export function countChecklist(items: { status: string | null }[]): Counts<ChecklistStatus> {
  const counts = Object.fromEntries(CHECKLIST_STATUSES.map(s => [s, 0])) as Record<ChecklistStatus, number>
  for (const i of items) {
    const s = (CHECKLIST_STATUSES as readonly string[]).includes(i.status ?? '')
      ? (i.status as ChecklistStatus)
      : 'unknown'
    counts[s]++
  }
  return { counts, total: items.length }
}

export function countDocuments(docs: { parse_status: string | null }[]): Counts<DocBucket> {
  const counts: Record<DocBucket, number> = { processed: 0, partial: 0, failed: 0, pending: 0, skipped: 0 }
  for (const d of docs) counts[docBucket(d.parse_status)]++
  return { counts, total: docs.length }
}

/**
 * Items the agent has reached a view on — the signal that ASSESSMENT ran.
 *
 * This is coverage of the agent's work, NOT completeness of the diligence: a
 * `missing` item is assessed, and it is still a hole in the deal. Use
 * `checklistCoverage` for "how complete is this checklist"; the two are different
 * questions and conflating them overstates the deal.
 */
export function assessedCount(counts: Record<ChecklistStatus, number>): number {
  return counts.found + counts.partial + counts.missing + counts.not_applicable
}

export interface ChecklistCoverage {
  /** Weighted count of applicable items we actually hold evidence for. */
  covered: number
  /** Applicable items — the denominator. Excludes N/A. */
  applicable: number
  /** Assessed items we do NOT hold — the gaps. */
  gaps: number
  /** 0–1. `applicable === 0` (everything N/A) reads as complete, not as zero. */
  fraction: number
}

/**
 * How complete the checklist ACTUALLY is — the share of applicable items backed by
 * evidence we hold.
 *
 * The rules, and why:
 *   • `missing`  — contributes NOTHING. An item the agent looked at and confirmed we
 *     don't have is a gap, not progress. Counting it (as `assessedCount` does) is
 *     what let a deal with most of its checklist missing still read ~90% complete.
 *   • `unknown`  — contributes nothing either. Not yet judged is not yet obtained.
 *   • `partial`  — half credit. Some evidence, not enough to call it satisfied.
 *   • `not_applicable` — leaves the DENOMINATOR entirely. It can never be obtained,
 *     so scoring it as either a gap or a win would distort the number.
 */
export function checklistCoverage(counts: Record<ChecklistStatus, number>): ChecklistCoverage {
  const applicable = counts.found + counts.partial + counts.missing + counts.unknown
  const covered = counts.found + counts.partial * 0.5
  const gaps = counts.missing
  return {
    covered,
    applicable,
    gaps,
    fraction: applicable === 0 ? 1 : covered / applicable,
  }
}

// ---------------------------------------------------------------------------
// Memo attention queue
// ---------------------------------------------------------------------------

export interface AttentionCounts {
  /** Open `must_address` items. Any one of these keeps the memo off 'done'. */
  blocking: number
  /** Open `must_address` + `should_address`. */
  open: number
  /** All `must_address` + `should_address`, open or not. */
  total: number
}

/**
 * Bucket the partner-attention queue for the memo stage.
 *
 * `fyi` is excluded entirely — it is informational and gates nothing. Statuses are
 * `open | done | ignore` (renamed from `addressed`/`deferred` in
 * 20260610000000_diligence_attention_status_rename.sql). Anything that is not `open`
 * counts as HANDLED — a partner deliberately setting an item aside is a decision, not
 * an outstanding gap — so the test is on `open` rather than on the settled names, and
 * a future rename of those cannot silently break it.
 */
export function countAttention(items: { urgency: string | null; status: string | null }[]): AttentionCounts {
  let blocking = 0, open = 0, total = 0
  for (const i of items) {
    if (i.urgency !== 'must_address' && i.urgency !== 'should_address') continue
    total++
    if (i.status !== 'open') continue
    open++
    if (i.urgency === 'must_address') blocking++
  }
  return { blocking, open, total }
}

// ---------------------------------------------------------------------------
// The master stage bar
// ---------------------------------------------------------------------------

export interface ProgressInput {
  hasIngestion: boolean
  hasResearch: boolean
  hasMemoDraft: boolean
  hasScores: boolean
  finalized: boolean
  documentCount: number
  /** Documents that have reached a settled parse state — processed, partial or skipped. */
  documentsHandled: number
  checklistAssessed: number
  checklistTotal: number
  /**
   * Applicable items backed by evidence, and how many applicable items there are —
   * from `checklistCoverage`. This, NOT `checklistAssessed`, drives the bar: a
   * `missing` item is assessed but it is not done.
   */
  checklistCovered: number
  checklistApplicable: number
  /** Assessed items we don't hold. Any gap keeps the stage off 'done'. */
  checklistGaps: number
  /** Rubric dimensions the scorer reached a view on, and how many exist. */
  scoredDimensions: number
  totalDimensions: number
  /**
   * The memo's partner-attention queue. `fyi` items are excluded throughout — they
   * are informational and were never meant to gate anything.
   *
   * `memoAttentionBlocking` counts still-OPEN `must_address` items: any one of them
   * keeps the memo off 'done'. A draft the agent flagged with a dozen unresolved
   * must-addresses is not a finished memo, and reading as 'done' overstated it.
   * `deferred` counts as handled — a partner deliberately setting an item aside is a
   * decision, not an omission.
   */
  memoAttentionBlocking: number
  /** Open must_address + should_address items. */
  memoAttentionOpen: number
  /** All must_address + should_address items, open or not — the denominator. */
  memoAttentionTotal: number
  /** The in-flight job, if any. */
  runningKind: string | null
  failedKind: string | null
}

/** Which stage a job kind belongs to. Several kinds roll up to one stage. */
const KIND_TO_STAGE: Record<string, StageKey> = {
  ingest: 'data_room',
  ingest_synthesis: 'data_room',
  transcribe: 'data_room',
  checklist_assessment: 'checklist',
  research: 'research',
  draft: 'memo',
  draft_review: 'memo',
  render: 'memo',
  score: 'scoring',
}

/**
 * A stage that isn't finished must never READ as full, so partial fill is capped just
 * below 100%.
 *
 * This used to be 0.9, which was its own small lie: it flattened every partial stage
 * from 90% upward onto exactly "90%", so a barely-started stage and an almost-finished
 * one could print the same number. 0.99 keeps the guarantee (nothing rounds to 100
 * unless it's genuinely done) without distorting the measurement underneath.
 */
const PARTIAL_CEILING = 0.99

export function buildStages(p: ProgressInput): StageInfo[] {
  const running = p.runningKind ? KIND_TO_STAGE[p.runningKind] ?? null : null
  const failed = p.failedKind ? KIND_TO_STAGE[p.failedKind] ?? null : null

  const state = (
    key: StageKey,
    done: boolean,
    blocked: boolean,
    blockedHint: string,
    hint: string,
    /** 0–1 share of the stage's own work that's finished, where that's measurable. */
    fraction = 0,
  ): StageInfo => {
    let st: StageState = 'todo'
    if (running === key) st = 'running'
    else if (done) st = 'done'
    else if (failed === key) st = 'failed'
    else if (blocked) st = 'blocked'
    else if (fraction > 0) st = 'partial'

    const progress = st === 'done' ? 1
      : st === 'blocked' ? 0
      : Math.min(Math.max(fraction, 0), PARTIAL_CEILING)

    return {
      key, label: '', state: st, progress, tab: '', action: null, actionLabel: '',
      hint: st === 'blocked' ? blockedHint : hint,
    }
  }

  const share = (n: number, d: number) => (d > 0 ? n / d : 0)

  const dataRoom = {
    ...state(
      'data_room', p.hasIngestion, p.documentCount === 0,
      'Upload documents first', 'Read every document and extract the evidence base',
      share(p.documentsHandled, p.documentCount),
    ),
    label: 'Data room',
    tab: 'Data Room',
    action: 'ingest',
    actionLabel: p.hasIngestion ? 'Re-analyze data room' : 'Analyze data room',
  }

  // The checklist is done when every item has been assessed AND nothing applicable is
  // still missing. Assessment coverage alone is NOT completion: an item the agent
  // judged and found absent is a hole in the deal, and a bar that counts it as
  // progress overstates how far along the diligence is. So the fill tracks evidence
  // we hold (`checklistCoverage`), and any gap keeps the stage amber no matter how
  // thoroughly it was assessed.
  const fullyAssessed = p.checklistTotal > 0 && p.checklistAssessed === p.checklistTotal
  const checklist = {
    ...state(
      'checklist',
      fullyAssessed && p.checklistGaps === 0,
      !p.hasIngestion,
      'Analyze the data room first',
      fullyAssessed && p.checklistGaps > 0
        ? `${p.checklistGaps} item${p.checklistGaps === 1 ? '' : 's'} still missing — request them from the company`
        : 'Judge each checklist item against the evidence',
      share(p.checklistCovered, p.checklistApplicable),
    ),
    label: 'Checklist',
    tab: 'Checklist',
    action: 'checklist-assessment',
    actionLabel: p.checklistAssessed > 0 ? 'Re-assess checklist' : 'Assess checklist',
  }

  const research = {
    ...state('research', p.hasResearch, !p.hasIngestion, 'Analyze the data room first', 'Search outside the data room — market, competitors, team'),
    label: 'Research',
    tab: 'Research',
    action: 'research',
    actionLabel: p.hasResearch ? 'Re-run research' : 'Run research',
  }

  // Scoring reads the evidence base directly (ingestion + research + Q&A), so it is
  // NOT gated on the memo — you can score a deal you never write up, and the memo can
  // then quote the scores. It's only "done" once every rubric dimension has been
  // reached; a rubric with unscored dimensions left over shows as partial.
  const scoring = {
    ...state(
      'scoring',
      p.hasScores && p.totalDimensions > 0 && p.scoredDimensions === p.totalDimensions,
      !p.hasIngestion,
      'Analyze the data room first', 'Score the deal against the fund’s criteria',
      share(p.scoredDimensions, p.totalDimensions),
    ),
    label: 'Scoring',
    tab: 'Scoring',
    action: 'score',
    actionLabel: p.hasScores ? 'Re-run scoring' : 'Run scoring',
  }

  // The memo is done when it is FINALIZED and no must-address item is still open —
  // not merely when a draft row exists, which is all this used to check (and which
  // meant a raw first draft, flagged by the agent with a dozen unresolved issues,
  // reported as a completed stage). The fill tracks the attention queue being worked
  // down; `finalized` is the last gate, so a fully-addressed but unfinalized memo
  // sits just short of the end rather than jumping to done.
  const memoHint =
    !p.hasMemoDraft ? 'Assemble the investment memo from everything gathered'
    : p.memoAttentionBlocking > 0 ? `${p.memoAttentionBlocking} must-address item${p.memoAttentionBlocking === 1 ? '' : 's'} still open`
    : p.memoAttentionOpen > 0 ? `${p.memoAttentionOpen} open item${p.memoAttentionOpen === 1 ? '' : 's'} to work through`
    : !p.finalized ? 'Every item addressed — finalize the memo'
    : 'Assemble the investment memo from everything gathered'

  const memo = {
    ...state(
      'memo',
      p.hasMemoDraft && p.finalized && p.memoAttentionBlocking === 0,
      !p.hasIngestion,
      'Analyze the data room first',
      memoHint,
      !p.hasMemoDraft ? 0
        : p.memoAttentionTotal > 0
          ? share(p.memoAttentionTotal - p.memoAttentionOpen, p.memoAttentionTotal)
          : 1,
    ),
    label: 'Memo',
    tab: 'Memo',
    action: 'draft',
    actionLabel: p.hasMemoDraft ? 'Re-draft memo' : 'Draft memo',
  }

  // Pipeline order — evidence, then judgement, then the write-up.
  return [dataRoom, checklist, research, scoring, memo]
}

/** How far through the pipeline, for the headline "3 of 6". */
export function stageProgress(stages: StageInfo[]): { done: number; total: number } {
  return { done: stages.filter(s => s.state === 'done').length, total: stages.length }
}
