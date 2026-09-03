import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAffinityKey, markAffinityKeyError } from '@/lib/affinity/credentials'
import { importAffinityIntoDataRoom, type ImportEvent } from '@/lib/affinity/import'
import { enqueueIngestForDocuments } from '@/lib/diligence/enqueue-ingest'
import { AffinityError } from '@/lib/affinity/client'

/**
 * Manual "Import from Affinity" — pulls the linked organization's notes and
 * attached files into the deal's data room.
 *
 * Runs as the CALLER's Affinity key (not the deal's linker), so a partner can
 * import what they can see even on a deal someone else linked.
 *
 * Streams NDJSON progress, mirroring the Google Drive importer so the deal-room
 * UI can reuse the same progress component:
 *   {type:'log'|'listed'|'progress'|'imported'|'skipped'|'error'|'done', ...}
 */

export const maxDuration = 120

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
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
    .select('id, affinity_organization_id, affinity_opportunity_id')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const organizationId = (deal as any).affinity_organization_id as number | null
  if (!organizationId) {
    return NextResponse.json(
      { error: 'Link this deal to an Affinity company first.' },
      { status: 400 }
    )
  }

  const apiKey = await getAffinityKey(admin, user.id)
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Connect your Affinity account in Settings first.', needs_connection: true },
      { status: 400 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const notesOnly = body.notes_only === true

  // Upfront validation returns plain JSON; once we start streaming the client
  // knows processing is under way.
  const dealId = params.id
  const userId = user.id
  const opportunityId = (deal as any).affinity_opportunity_id as number | null

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: ImportEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      }

      try {
        const result = await importAffinityIntoDataRoom({
          admin,
          apiKey,
          fundId,
          dealId,
          organizationId,
          opportunityId,
          userId,
          notesOnly,
          emit,
        })

        // Imported-but-not-ingested documents are invisible to the memo agent,
        // so the import isn't really done until ingest is queued.
        if (result.documentIds.length > 0) {
          const ingest = await enqueueIngestForDocuments(admin, {
            fundId,
            dealId,
            documentIds: result.documentIds,
            enqueuedBy: userId,
          })
          emit({
            type: 'log',
            message: ingest.enqueued
              ? 'Queued the new documents for parsing into the memo evidence base.'
              : `Imported, but parsing was not queued (${ingest.reason}). Run Ingest from the deal room when the current job finishes.`,
          })
        }
      } catch (err) {
        if (err instanceof AffinityError && err.status === 401) {
          await markAffinityKeyError(admin, userId, err.message).catch(() => {})
        }
        emit({
          type: 'error',
          item: 'Affinity import',
          error: err instanceof Error ? err.message : 'Import failed',
        })
        emit({ type: 'done', imported: 0, skipped: 0, errors: 1 })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
