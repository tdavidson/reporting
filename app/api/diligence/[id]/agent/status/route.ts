import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildStages, countChecklist, countDocuments, assessedCount, checklistCoverage, countAttention } from '@/lib/diligence/progress'

/**
 * Polled by the deal detail UI while a memo-agent job is in flight.
 * Returns the most recent job for the deal plus a snapshot of which
 * stages have output on the latest draft.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  const fundId = (membership as any).fund_id as string

  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id, current_memo_stage')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [{ data: latestJob }, { data: latestDraft }, { data: lastIngestJob }, { data: lastDraftJob }] = await Promise.all([
    admin
      .from('memo_agent_jobs')
      .select('id, kind, status, progress_message, error, attempts, enqueued_at, started_at, finished_at, result')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .order('enqueued_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('diligence_memo_drafts')
      .select('id, draft_version, ingestion_output, research_output, qa_answers, memo_draft_output, is_draft, created_at, finalized_at')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Most recent successful ingestion (per-doc or synthesis) — the moment
    // the deal's evidence base last changed.
    admin
      .from('memo_agent_jobs')
      .select('finished_at')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .eq('status', 'success')
      .in('kind', ['ingest', 'ingest_synthesis'])
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Most recent successful draft build — the moment the memo prose was
    // last assembled from the evidence base.
    admin
      .from('memo_agent_jobs')
      .select('finished_at')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .eq('status', 'success')
      .in('kind', ['draft', 'draft_review'])
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Memo is "stale" when ingestion has run more recently than the draft —
  // i.e. evidence was added/changed after the memo prose was assembled.
  const ingestAt = (lastIngestJob as { finished_at: string } | null)?.finished_at ?? null
  const draftAt = (lastDraftJob as { finished_at: string } | null)?.finished_at ?? null
  // "Has a memo" means memo PROSE exists — not merely that memo_draft_output is
  // non-null. Scoring now runs without the memo and parks its scores in that same
  // column, so a scores-only object must not read as a drafted memo.
  const memoParagraphs = (latestDraft as any)?.memo_draft_output?.paragraphs
  const hasMemo = Array.isArray(memoParagraphs) && memoParagraphs.length > 0
  const memoStale = hasMemo && !!ingestAt && !!draftAt && ingestAt > draftAt

  // Best-effort count of documents uploaded since the memo was drafted.
  let documentsAddedSinceDraft = 0
  if (memoStale && draftAt) {
    const { count } = await admin
      .from('diligence_documents')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .gt('uploaded_at', draftAt)
    documentsAddedSinceDraft = count ?? 0
  }

  // The three bars need checklist statuses and document parse states. Fetching them
  // here means one poll drives the whole progress view, instead of each tab doing its
  // own round trip and disagreeing with the others.
  const [{ data: checklistRows }, { data: docRows }, { data: attentionRows }] = await Promise.all([
    (admin as any)
      .from('diligence_checklist_items')
      .select('status')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .eq('kind', 'item'),
    (admin as any)
      .from('diligence_documents')
      .select('parse_status')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId),
    // The memo's partner-attention queue gates the memo stage: a draft with open
    // must-address items is not a finished memo.
    (admin as any)
      .from('diligence_attention_items')
      .select('urgency, status')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId),
  ])

  const checklist = countChecklist(((checklistRows as any[]) ?? []).map(r => ({ status: r.status })))
  const dataRoom = countDocuments(((docRows as any[]) ?? []).map(r => ({ parse_status: r.parse_status })))
  const coverage = checklistCoverage(checklist.counts)
  const attention = countAttention(
    ((attentionRows as any[]) ?? []).map(r => ({ urgency: r.urgency, status: r.status }))
  )

  // Scoring lives inside the draft's memo_draft_output, not in its own column, so
  // there was no way to tell "has it been scored" without a separate /drafts fetch.
  const scores = (latestDraft as any)?.memo_draft_output?.scores
  const scoreRows: Array<{ score: number | null; mode?: string }> = Array.isArray(scores) ? scores : []
  const hasScores = scoreRows.length > 0
  // A dimension counts as reached once it has a number, or once it's partner_only —
  // those are never machine-scored, so waiting on one would strand the stage forever.
  const scoredDimensions = scoreRows.filter(s => s.score !== null || s.mode === 'partner_only').length

  // Documents in a settled parse state. Failed ones are a problem, not progress.
  const documentsHandled = dataRoom.counts.processed + dataRoom.counts.partial + dataRoom.counts.skipped

  const job = latestJob as any
  const runningKind = job && (job.status === 'pending' || job.status === 'running') ? job.kind : null
  const failedKind = job && job.status === 'failed' ? job.kind : null

  const stages = buildStages({
    hasIngestion: !!(latestDraft as any)?.ingestion_output,
    hasResearch: !!(latestDraft as any)?.research_output,
    hasMemoDraft: hasMemo,
    hasScores,
    finalized: !!(latestDraft as any)?.finalized_at,
    documentCount: dataRoom.total,
    documentsHandled,
    checklistAssessed: assessedCount(checklist.counts),
    checklistTotal: checklist.total,
    checklistCovered: coverage.covered,
    checklistApplicable: coverage.applicable,
    checklistGaps: coverage.gaps,
    scoredDimensions,
    totalDimensions: scoreRows.length,
    memoAttentionBlocking: attention.blocking,
    memoAttentionOpen: attention.open,
    memoAttentionTotal: attention.total,
    runningKind,
    failedKind,
  })

  return NextResponse.json({
    deal: { id: (deal as any).id, current_memo_stage: (deal as any).current_memo_stage },
    latest_job: latestJob ?? null,
    latest_draft: latestDraft ? {
      id: (latestDraft as any).id,
      draft_version: (latestDraft as any).draft_version,
      is_draft: (latestDraft as any).is_draft,
      created_at: (latestDraft as any).created_at,
      finalized_at: (latestDraft as any).finalized_at,
      has_ingestion: !!(latestDraft as any).ingestion_output,
      has_research: !!(latestDraft as any).research_output,
      has_qa: !!(latestDraft as any).qa_answers,
      has_memo_draft: hasMemo,
      has_scores: hasScores,
    } : null,
    memo_stale: memoStale,
    documents_added_since_draft: documentsAddedSinceDraft,
    // Progress model — drives the stage bar and the two composition bars.
    progress: {
      stages,
      checklist,
      data_room: dataRoom,
      checklist_assessed: assessedCount(checklist.counts),
      // Assessment coverage and real completeness are different questions — the bar
      // reports the latter, so both travel with it rather than being conflated.
      checklist_coverage: coverage,
      memo_attention: attention,
    },
  })
}
