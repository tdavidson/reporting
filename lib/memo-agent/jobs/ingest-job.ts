import { createAdminClient } from '@/lib/supabase/admin'
import { runIngestDocs } from '@/lib/memo-agent/stages/ingest'
import { listIngestableDocumentIds } from '@/lib/memo-agent/ingestion/sources'

type Admin = ReturnType<typeof createAdminClient>

interface IngestJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
  enqueued_by?: string | null
}

// Documents processed per worker invocation. A large data room is split into
// batches across cron ticks so no single run approaches the Vercel function
// ceiling. runIngestDocs also enforces a soft time budget as a second guard.
const BATCH_SIZE = 8

/**
 * Worker entry point for the `ingest` kind. Processes up to BATCH_SIZE
 * documents per run, persisting per-doc results to the draft. If documents
 * remain (queued or deferred by the time budget) it re-enqueues another
 * `ingest` job to continue; once the whole data room is done it advances the
 * deal stage and enqueues the `ingest_synthesis` follow-up. Batching across
 * ticks is what keeps multi-doc data rooms from orphaning at the function
 * ceiling — the symptom being a job killed as "timed out (>6m)".
 */
export async function runIngestJob(admin: Admin, job: IngestJob): Promise<unknown> {
  const explicitIds = Array.isArray(job.payload?.document_ids)
    ? (job.payload.document_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : null
  // "Re-analyze everything": re-ingest the whole data room (replacing stale
  // results) and re-assess every checklist item. Carried through continuation
  // batches and into the synthesis follow-up.
  const full = job.payload?.full === true

  // A fresh full run (no document_ids) resolves the whole data room and
  // replaces prior results. Continuation batches and failed-doc re-runs carry
  // an explicit id list and merge into the existing set.
  const isExplicit = !!explicitIds && explicitIds.length > 0
  const queue = isExplicit
    ? explicitIds!
    : await listIngestableDocumentIds(admin, job.deal_id, job.fund_id)
  const replaceExisting = !isExplicit

  const batch = queue.slice(0, BATCH_SIZE)
  const queuedRemainder = queue.slice(BATCH_SIZE)

  // Nothing to process — don't create a draft or enqueue synthesis.
  if (batch.length === 0) {
    return { draft_id: job.draft_id, documents_processed: 0, remaining: 0, synthesis_job_id: null, warnings: [] as string[] }
  }

  const result = await runIngestDocs({
    admin,
    fundId: job.fund_id,
    dealId: job.deal_id,
    documentIds: batch,
    draftId: job.draft_id ?? undefined,
    replaceExisting,
    progressCb: async (msg) => {
      await admin
        .from('memo_agent_jobs')
        .update({ progress_message: msg } as any)
        .eq('id', job.id)
    },
  })

  if (result.draft_id && !job.draft_id) {
    await admin
      .from('memo_agent_jobs')
      .update({ draft_id: result.draft_id } as any)
      .eq('id', job.id)
  }

  // Documents still to process: those past this batch, plus any the time
  // budget deferred mid-batch.
  const remaining = [...queuedRemainder, ...result.deferred_document_ids]

  if (remaining.length > 0) {
    // More to do — continue on the next tick. Carry the same draft so all
    // batches accumulate into one ingestion_output, and mark it a continuation
    // so it merges (doesn't replace) and skips the full-run resolve.
    const { data: cont, error: contErr } = await admin
      .from('memo_agent_jobs')
      .insert({
        fund_id: job.fund_id,
        deal_id: job.deal_id,
        draft_id: result.draft_id,
        kind: 'ingest',
        payload: { document_ids: remaining, continuation: true, ...(full ? { full: true } : {}) },
        enqueued_by: job.enqueued_by ?? null,
      } as any)
      .select('id')
      .single()
    if (contErr || !cont) {
      throw new Error(`Ingest batch succeeded but the continuation job could not be enqueued: ${contErr?.message ?? 'unknown error'}.`)
    }
    return {
      draft_id: result.draft_id,
      documents_processed: result.documents_processed,
      claims_extracted: result.ingestion_documents.reduce((acc, d) => acc + d.claims.length, 0),
      remaining: remaining.length,
      continuation_job_id: (cont as { id: string }).id,
      warnings: result.warnings,
    }
  }

  // Whole data room processed. Advance the deal stage (only from 'ingest' — a
  // failed-doc re-run while further along shouldn't bounce it back).
  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: 'research' } as any)
    .eq('id', job.deal_id)
    .eq('fund_id', job.fund_id)
    .eq('current_memo_stage', 'ingest')

  // Enqueue the cross-doc synthesis follow-up on its own budget. Synthesis
  // no-ops on an empty draft, so it's safe to enqueue whenever a draft exists.
  let synthesis_job_id: string | null = null
  if (result.draft_id) {
    const { data: enq, error: enqErr } = await admin
      .from('memo_agent_jobs')
      .insert({
        fund_id: job.fund_id,
        deal_id: job.deal_id,
        draft_id: result.draft_id,
        kind: 'ingest_synthesis',
        payload: full ? { full: true } : {},
        enqueued_by: job.enqueued_by ?? null,
      } as any)
      .select('id')
      .single()
    // Fail loudly rather than silently landing per-doc results with no
    // gap analysis / cross-doc flags.
    if (enqErr || !enq) {
      throw new Error(
        `Ingest succeeded but the synthesis job could not be enqueued: ${enqErr?.message ?? 'unknown error'}. ` +
        `If this mentions a check constraint on "kind", apply the memo_agent_jobs kind migration (supabase db push).`
      )
    }
    synthesis_job_id = (enq as { id: string }).id
  }

  return {
    draft_id: result.draft_id,
    documents_processed: result.documents_processed,
    claims_extracted: result.ingestion_documents.reduce((acc, d) => acc + d.claims.length, 0),
    remaining: 0,
    synthesis_job_id,
    warnings: result.warnings,
  }
}
