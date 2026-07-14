import { describe, it, expect } from 'vitest'
import {
  buildStages, countChecklist, countDocuments, docBucket, assessedCount, stageProgress,
  checklistCoverage, countAttention,
  type ProgressInput,
} from './progress'

const base: ProgressInput = {
  hasIngestion: false,
  hasResearch: false,
  hasMemoDraft: false,
  hasScores: false,
  finalized: false,
  documentCount: 0,
  documentsHandled: 0,
  checklistAssessed: 0,
  checklistTotal: 0,
  checklistCovered: 0,
  checklistApplicable: 0,
  checklistGaps: 0,
  scoredDimensions: 0,
  totalDimensions: 0,
  memoAttentionBlocking: 0,
  memoAttentionOpen: 0,
  memoAttentionTotal: 0,
  runningKind: null,
  failedKind: null,
}
const stagesOf = (p: Partial<ProgressInput>) => {
  const s = buildStages({ ...base, ...p })
  return Object.fromEntries(s.map(x => [x.key, x.state]))
}
const stage = (p: Partial<ProgressInput>, key: string) =>
  buildStages({ ...base, ...p }).find(s => s.key === key)!

describe('countDocuments', () => {
  it('buckets parse_status, treating anything unknown as not-processed', () => {
    const { counts, total } = countDocuments([
      { parse_status: 'parsed' },
      { parse_status: 'transcribed' }, // a processed recording still counts as read
      { parse_status: 'partial' },
      { parse_status: 'failed' },
      { parse_status: 'pending' },
      { parse_status: 'skipped' },
      { parse_status: null },          // no status at all → not processed
      { parse_status: 'something_new' }, // parse_status has no CHECK constraint
    ])
    expect(counts.processed).toBe(2)
    expect(counts.partial).toBe(1)
    expect(counts.failed).toBe(1)
    expect(counts.pending).toBe(3) // pending + null + unknown value
    expect(counts.skipped).toBe(1)
    expect(total).toBe(8)
  })

  it('never silently drops a document', () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({ parse_status: ['parsed', 'failed', null, 'zzz'][i % 4] }))
    const { counts, total } = countDocuments(docs)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(total)
  })

  it('maps an unrecognized status to pending rather than crashing', () => {
    expect(docBucket(undefined)).toBe('pending')
    expect(docBucket('who_knows')).toBe('pending')
  })
})

describe('countChecklist', () => {
  it('counts by status; an unrecognized status falls back to unknown', () => {
    const { counts, total } = countChecklist([
      { status: 'found' }, { status: 'found' },
      { status: 'partial' },
      { status: 'missing' },
      { status: 'not_applicable' },
      { status: 'unknown' },
      { status: null },
      { status: 'garbage' },
    ])
    expect(counts.found).toBe(2)
    expect(counts.unknown).toBe(3) // unknown + null + garbage
    expect(total).toBe(8)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(total)
  })

  it('assessed = anything the agent reached a view on', () => {
    const { counts } = countChecklist([
      { status: 'found' }, { status: 'partial' }, { status: 'missing' },
      { status: 'not_applicable' }, { status: 'unknown' },
    ])
    expect(assessedCount(counts)).toBe(4) // everything except `unknown`
  })
})

describe('buildStages', () => {
  it('a fresh deal blocks everything behind the data room', () => {
    const s = stagesOf({})
    expect(s.data_room).toBe('blocked')   // no documents yet
    expect(s.checklist).toBe('blocked')
    expect(s.research).toBe('blocked')
    expect(s.memo).toBe('blocked')
    expect(s.scoring).toBe('blocked')
  })

  it('uploading documents unblocks the data room but nothing downstream', () => {
    const s = stagesOf({ documentCount: 5 })
    expect(s.data_room).toBe('todo')
    expect(s.research).toBe('blocked') // still needs ingestion
  })

  it('ingestion unblocks everything downstream, scoring included', () => {
    const s = stagesOf({ documentCount: 5, hasIngestion: true, checklistTotal: 10 })
    expect(s.data_room).toBe('done')
    expect(s.checklist).toBe('todo')
    expect(s.research).toBe('todo')
    expect(s.memo).toBe('todo')
    // Scoring judges the evidence, not the memo — the data room is all it waits on.
    expect(s.scoring).toBe('todo')
  })

  it('scoring does NOT wait for the memo — you can score a deal you never write up', () => {
    const s = stagesOf({
      documentCount: 5, hasIngestion: true,
      hasScores: true, scoredDimensions: 8, totalDimensions: 8,
    })
    expect(s.scoring).toBe('done')
    expect(s.memo).toBe('todo') // still undrafted, and that's fine
  })

  it('scoring is ordered before the memo', () => {
    const keys = buildStages(base).map(s => s.key)
    expect(keys).toEqual(['data_room', 'checklist', 'research', 'scoring', 'memo'])
    expect(keys.indexOf('scoring')).toBeLessThan(keys.indexOf('memo'))
  })

  it('there is no Q&A stage', () => {
    expect(buildStages(base).map(s => s.key)).not.toContain('qa')
  })

  it('the checklist is only done when every item is assessed AND nothing is missing', () => {
    const partly = stagesOf({
      documentCount: 1, hasIngestion: true,
      checklistTotal: 10, checklistAssessed: 9,
      checklistCovered: 9, checklistApplicable: 10, checklistGaps: 0,
    })
    expect(partly.checklist).toBe('partial')

    const all = stagesOf({
      documentCount: 1, hasIngestion: true,
      checklistTotal: 10, checklistAssessed: 10,
      checklistCovered: 10, checklistApplicable: 10, checklistGaps: 0,
    })
    expect(all.checklist).toBe('done')
  })

  // The bug: every item assessed, but most of them assessed as MISSING. The old model
  // called that done at ~100%, because `missing` counted toward assessment coverage.
  it('a fully-assessed checklist with missing items is NOT done', () => {
    const s = stage({
      documentCount: 1, hasIngestion: true,
      checklistTotal: 10, checklistAssessed: 10,
      checklistCovered: 3, checklistApplicable: 10, checklistGaps: 7,
    }, 'checklist')
    expect(s.state).toBe('partial')
    expect(s.progress).toBeCloseTo(0.3)   // not 1.0 — the 7 missing items are holes
    expect(s.hint).toContain('7 items still missing')
  })

  it('an in-flight job shows as running on the stage it belongs to', () => {
    // ingest_synthesis is a separate job kind but the same stage as ingest.
    const s = stagesOf({ documentCount: 5, runningKind: 'ingest_synthesis' })
    expect(s.data_room).toBe('running')

    // draft_review rolls up to the memo stage.
    const m = stagesOf({ documentCount: 5, hasIngestion: true, runningKind: 'draft_review' })
    expect(m.memo).toBe('running')
  })

  it('running beats done — a re-run in flight is not "complete"', () => {
    const s = stagesOf({ documentCount: 5, hasIngestion: true, runningKind: 'ingest' })
    expect(s.data_room).toBe('running')
  })

  it('a failed job surfaces on its stage', () => {
    const s = stagesOf({ documentCount: 5, hasIngestion: true, failedKind: 'research' })
    expect(s.research).toBe('failed')
  })

  it('offers the right verb: run first, re-run after', () => {
    const first = buildStages({ ...base, documentCount: 3 }).find(s => s.key === 'data_room')!
    expect(first.actionLabel).toBe('Analyze data room')

    const again = buildStages({ ...base, documentCount: 3, hasIngestion: true }).find(s => s.key === 'data_room')!
    expect(again.actionLabel).toBe('Re-analyze data room')
  })

  it('a blocked stage explains what is blocking it', () => {
    const scoring = stage({ documentCount: 1 }, 'scoring')
    expect(scoring.state).toBe('blocked')
    expect(scoring.hint).toBe('Analyze the data room first')
  })

  it('counts completed stages for the headline', () => {
    const stages = buildStages({
      ...base, documentCount: 5, hasIngestion: true, hasResearch: true,
      checklistTotal: 4, checklistAssessed: 4,
      checklistCovered: 4, checklistApplicable: 4, checklistGaps: 0,
    })
    expect(stageProgress(stages)).toEqual({ done: 3, total: 5 }) // data room, checklist, research
  })

  // A first draft is not a finished memo. It used to read as done the moment a draft
  // row existed — even with a dozen unresolved must-address items on it.
  it('the memo is NOT done while must-address items are open', () => {
    const s = stage({
      documentCount: 1, hasIngestion: true, hasMemoDraft: true, finalized: true,
      memoAttentionTotal: 10, memoAttentionOpen: 4, memoAttentionBlocking: 3,
    }, 'memo')
    expect(s.state).toBe('partial')
    expect(s.progress).toBeCloseTo(0.6)
    expect(s.hint).toContain('3 must-address items still open')
  })

  it('the memo is NOT done while unfinalized, even with everything addressed', () => {
    const s = stage({
      documentCount: 1, hasIngestion: true, hasMemoDraft: true, finalized: false,
      memoAttentionTotal: 5, memoAttentionOpen: 0, memoAttentionBlocking: 0,
    }, 'memo')
    expect(s.state).toBe('partial')
    expect(s.hint).toContain('finalize')
  })

  it('the memo is done once finalized with no must-address item open', () => {
    const s = stage({
      documentCount: 1, hasIngestion: true, hasMemoDraft: true, finalized: true,
      memoAttentionTotal: 5, memoAttentionOpen: 0, memoAttentionBlocking: 0,
    }, 'memo')
    expect(s.state).toBe('done')
    expect(s.progress).toBe(1)
  })
})

describe('checklistCoverage', () => {
  const counts = (p: Partial<Record<string, number>>) => ({
    found: 0, partial: 0, missing: 0, unknown: 0, not_applicable: 0, ...p,
  } as any)

  it('missing items are gaps, NOT progress — this is the bug', () => {
    // 9 of 10 assessed as missing. Assessment coverage says 100%; completeness is 10%.
    const c = checklistCoverage(counts({ found: 1, missing: 9 }))
    expect(c.fraction).toBeCloseTo(0.1)
    expect(c.gaps).toBe(9)
  })

  it('unassessed items count for nothing', () => {
    expect(checklistCoverage(counts({ found: 2, unknown: 8 })).fraction).toBeCloseTo(0.2)
  })

  it('partial earns half credit', () => {
    expect(checklistCoverage(counts({ found: 1, partial: 2, missing: 1 })).fraction).toBeCloseTo(0.5)
  })

  it('N/A leaves the denominator entirely — it can never be obtained', () => {
    const c = checklistCoverage(counts({ found: 3, not_applicable: 7 }))
    expect(c.applicable).toBe(3)
    expect(c.fraction).toBe(1)
  })

  it('an all-N/A checklist reads complete, not zero', () => {
    expect(checklistCoverage(counts({ not_applicable: 5 })).fraction).toBe(1)
  })
})

describe('countAttention', () => {
  // Statuses are open | done | ignore (renamed from addressed/deferred).
  it('only open must/should items count against the memo; fyi never gates', () => {
    const a = countAttention([
      { urgency: 'must_address', status: 'open' },
      { urgency: 'must_address', status: 'done' },
      { urgency: 'should_address', status: 'open' },
      { urgency: 'fyi', status: 'open' },          // informational — excluded entirely
    ])
    expect(a).toEqual({ blocking: 1, open: 2, total: 3 })
  })

  it('ignore counts as handled — setting an item aside is a decision', () => {
    const a = countAttention([{ urgency: 'must_address', status: 'ignore' }])
    expect(a).toEqual({ blocking: 0, open: 0, total: 1 })
  })
})

// The bar has to distinguish "not started" from "half way through", so every stage
// carries a 0–1 progress alongside its state.
describe('stage progress (the intermediate fill)', () => {
  it('a part-assessed checklist is partial, and reports the evidence actually held', () => {
    const s = stage({
      documentCount: 1, hasIngestion: true,
      checklistTotal: 10, checklistAssessed: 4,
      checklistCovered: 4, checklistApplicable: 10, checklistGaps: 0,
    }, 'checklist')
    expect(s.state).toBe('partial')
    expect(s.progress).toBeCloseTo(0.4)
  })

  it('a part-parsed data room is partial', () => {
    const s = stage({ documentCount: 10, documentsHandled: 3 }, 'data_room')
    expect(s.state).toBe('partial')
    expect(s.progress).toBeCloseTo(0.3)
  })

  it('a rubric with dimensions left unscored is partial, not done', () => {
    const s = stage({
      documentCount: 1, hasIngestion: true,
      hasScores: true, scoredDimensions: 5, totalDimensions: 8,
    }, 'scoring')
    expect(s.state).toBe('partial')
    expect(s.progress).toBeCloseTo(0.625)
  })

  it('an unfinished stage never renders as 100% — partial fill is capped', () => {
    // Every document parsed, but the synthesis that produces the evidence base
    // hasn't run: the stage is not done, so the bar must not read as full.
    const s = stage({ documentCount: 10, documentsHandled: 10 }, 'data_room')
    expect(s.state).toBe('partial')
    expect(s.progress).toBeLessThan(1)
  })

  it('done is exactly 1, blocked and todo are exactly 0', () => {
    expect(stage({ documentCount: 5, documentsHandled: 5, hasIngestion: true }, 'data_room').progress).toBe(1)
    expect(stage({ documentCount: 1 }, 'scoring').progress).toBe(0)   // blocked
    expect(stage({ documentCount: 1, hasIngestion: true }, 'research').progress).toBe(0) // todo
  })
})
