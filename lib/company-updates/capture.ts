import type { ReportingPeriod } from '@/lib/claude/extractMetrics'
import type { PostmarkPayload } from '@/lib/pipeline/processEmail'
import {
  BODY_CLEANER_VERSION,
  CAPTURE_VERSION,
  extractArtifact,
  extractEmailBody,
  type ExtractedArtifact,
  type ExtractionStatus,
} from './extraction'

/** The typed service-role client or any test double: only `from`/`rpc` are used, untyped. */
export type SupabaseAdmin = {
  from: (table: any) => any
  rpc: (...args: any[]) => any
}

type StoredInboundEmail = {
  id: string
  fund_id: string
  company_id: string | null
  from_address: string
  subject: string | null
  received_at: string
  routed_to: string | null
  raw_payload: PostmarkPayload | null
}

type StoredAttachment = NonNullable<PostmarkPayload['Attachments']>[number]

export type OcrStatus = 'not_needed' | 'pending' | 'running' | 'complete' | 'failed'

export interface CaptureResult {
  updateId: string
  extractionStatus: 'complete' | 'partial' | 'failed'
  artifacts: Array<{
    id: string
    ordinal: number
    filename: string
    detectedContentType: string | null
    status: ExtractionStatus
    ocrStatus: OcrStatus
  }>
}

/** The pipeline's shadow default is 'reporting'; a legacy row routed nowhere was processed as such. */
export function effectiveRoute(routedTo: string | null | undefined): string {
  return routedTo ?? 'reporting'
}

/** Longest subject or filename that becomes its own weight-A search chunk. */
const MAX_TITLE_CHUNK_CHARS = 2_000

/**
 * Materialize one eligible reporting email into the durable Company Updates projection.
 * The stored inbound row is authoritative for route, identity, timestamps, addresses and storage
 * paths. The supplied payload contributes attachment bytes only.
 *
 * All writes happen in ONE database transaction (`company_update_replace`): the update row, every
 * artifact (stale ones deleted), and every chunk. A failure leaves the previous projection intact
 * rather than a half-replaced one, and nothing removed from the source can stay searchable.
 */
export async function captureCompanyUpdate(
  supabase: SupabaseAdmin,
  params: {
    emailId: string
    fundId: string
    companyId: string
    payload: PostmarkPayload
  },
): Promise<CaptureResult | null> {
  const { emailId, fundId, companyId, payload } = params
  const email = await loadStoredInboundEmail(supabase, { emailId, fundId })
  if (effectiveRoute(email.routed_to) !== 'reporting') {
    await removeCompanyUpdate(supabase, { emailId, fundId })
    return null
  }
  if (email.company_id !== companyId) {
    throw new Error(`Company Update source email ${emailId} is not assigned to company ${companyId}.`)
  }

  const canonicalPayload = email.raw_payload ?? payload
  const body = extractEmailBody(canonicalPayload)
  const canonicalAttachments = canonicalPayload.Attachments ?? []
  const attachments = payload.Attachments ?? canonicalAttachments
  const extractedAttachments = []

  for (let runtimeIndex = 0; runtimeIndex < attachments.length; runtimeIndex++) {
    const attachment = attachments[runtimeIndex]
    const source = resolveStoredAttachment(emailId, runtimeIndex, attachment, canonicalAttachments)
    const sourceAttachment = source.attachment
    const ordinal = source.ordinal
    const extraction = await extractArtifact({
      filename: sourceAttachment.Name,
      declaredContentType: sourceAttachment.ContentType,
      content: attachment.Content,
      contentError: sourceAttachment.ContentError ?? attachment.ContentError,
    })
    if (
      sourceAttachment.ContentLength >= 0 &&
      extraction.byteSize !== null &&
      sourceAttachment.ContentLength !== extraction.byteSize
    ) {
      extraction.result.warnings.unshift(
        `Declared byte size ${sourceAttachment.ContentLength} differs from decoded size ${extraction.byteSize}.`,
      )
      if (extraction.result.status === 'complete') extraction.result.status = 'partial'
    }
    extractedAttachments.push({ attachment: sourceAttachment, source, ordinal, extraction })
  }

  const artifactStatuses = extractedAttachments.map(item => item.extraction.result.status)
  const extractionStatus = overallStatus(body.status, artifactStatuses)
  const warnings = [
    ...body.warnings,
    ...extractedAttachments.flatMap(item =>
      item.extraction.result.warnings.map(warning => `${item.attachment.Name}: ${warning}`),
    ),
  ]
  const envelopeSender = senderAttribution(email.from_address, canonicalPayload)

  const updateRow = {
    company_id: companyId,
    source_email_id: emailId,
    sender_name: envelopeSender.name,
    sender_email: envelopeSender.email,
    forwarded_sender_name: body.forwardedSender?.name ?? null,
    forwarded_sender_email: body.forwardedSender?.email ?? null,
    subject: email.subject,
    received_at: email.received_at,
    body_original: body.original,
    body_current: body.current,
    body_status: body.status,
    body_cleaning_status: body.cleaningStatus,
    body_cleaner_version: body.cleanerVersion,
    extraction_status: extractionStatus,
    warnings,
    parser_version: CAPTURE_VERSION,
  }

  const bodyChunks = [
    ...(email.subject?.trim()
      ? [chunkRow({ ordinal: 0, locator: { section: 'subject' }, text: email.subject.trim().slice(0, MAX_TITLE_CHUNK_CHARS) }, 'subject', BODY_CLEANER_VERSION)]
      : []),
    ...body.originalChunks.map(chunk => chunkRow(chunk, 'body_original', BODY_CLEANER_VERSION)),
    ...body.currentChunks.map(chunk => chunkRow(chunk, 'body_current', BODY_CLEANER_VERSION)),
  ]

  const artifactRows = extractedAttachments.map(({ attachment, source, ordinal, extraction }) => {
    const result = extraction.result
    const ocrStatus: OcrStatus = result.metadata.ocrNeeded === true ? 'pending' : 'not_needed'
    const title = attachment.Name?.trim()
    return {
      attachment_key: source.storagePath ? `storage:${source.storagePath}` : `ordinal:${ordinal}`,
      ordinal,
      filename: attachment.Name,
      declared_content_type: attachment.ContentType || null,
      detected_content_type: extraction.detectedContentType,
      storage_path: source.storagePath,
      byte_size: extraction.byteSize ?? attachment.ContentLength ?? null,
      content_sha256: extraction.contentSha256,
      extracted_text: result.text,
      extraction_status: result.status,
      parser: result.parser,
      parser_version: result.parserVersion,
      warnings: result.warnings,
      extraction_error: result.status === 'failed' ? result.warnings[result.warnings.length - 1] ?? 'Extraction failed.' : null,
      metadata: result.metadata,
      ocr_status: ocrStatus,
      chunks: [
        ...(title
          ? [chunkRow({ ordinal: 0, locator: { section: 'filename' }, text: title.slice(0, MAX_TITLE_CHUNK_CHARS) }, 'artifact_title', result.parserVersion)]
          : []),
        ...result.chunks.map(chunk => chunkRow(chunk, 'attachment', result.parserVersion)),
      ],
    }
  })

  const { data: replaced, error: replaceError } = await supabase.rpc('company_update_replace', {
    p_fund_id: fundId,
    p_update: updateRow,
    p_artifacts: artifactRows,
    p_body_chunks: bodyChunks,
  })
  assertNoError(replaceError, 'replace Company Update projection')
  const updateId = (replaced as { update_id?: string } | null)?.update_id
  if (!updateId) throw new Error(`Company Update replacement returned no id for source email ${emailId}.`)
  const artifactIds = ((replaced as { artifacts?: Record<string, string> }).artifacts ?? {})

  return {
    updateId,
    extractionStatus,
    artifacts: artifactRows.map(row => ({
      id: artifactIds[row.attachment_key] ?? '',
      ordinal: row.ordinal,
      filename: row.filename,
      detectedContentType: row.detected_content_type,
      status: row.extraction_status,
      ocrStatus: row.ocr_status,
    })),
  }
}

const LOAD_COLUMNS = 'id, fund_id, company_id, from_address, subject, received_at, routed_to'
const PAYLOAD_SCALARS = ['From', 'To', 'OriginalRecipient', 'Date', 'Subject', 'TextBody', 'HtmlBody', 'MessageID'] as const
const ATTACHMENT_FIELDS = ['Name', 'ContentType', 'ContentLength', 'StoragePath', 'ContentError'] as const
const MAX_LITE_ATTACHMENTS = 50

/**
 * The canonical stored email. Normally one select; when the row is too large to serve (an older
 * email whose attachment bytes were left base64-inline in raw_payload, which trips the API's
 * statement timeout), fall back to rebuilding the payload from scalar JSON paths — everything
 * except attachment Content. Those attachments are then captured as failed artifacts with the
 * reason, so the update still exists and its body is searchable rather than the whole email
 * silently missing from the corpus.
 */
export async function loadStoredInboundEmail(
  supabase: SupabaseAdmin,
  params: { emailId: string; fundId: string },
): Promise<StoredInboundEmail> {
  const { emailId, fundId } = params
  const { data, error } = await supabase
    .from('inbound_emails')
    .select(`${LOAD_COLUMNS}, raw_payload`)
    .eq('id', emailId)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!error) {
    if (!data) throw new Error(`Company Update source email ${emailId} was not found in fund ${fundId}.`)
    return data as StoredInboundEmail
  }
  if (!/statement timeout|canceling statement/i.test(error.message ?? '')) {
    throw new Error(`Could not load canonical inbound email: ${error.message ?? 'database error'}`)
  }

  const { data: lite, error: liteError } = await supabase
    .from('inbound_emails')
    .select(`${LOAD_COLUMNS}, attachments_count, ${PAYLOAD_SCALARS.map(key => `p_${key}:raw_payload->>${key}`).join(', ')}, p_FromFull:raw_payload->FromFull`)
    .eq('id', emailId)
    .eq('fund_id', fundId)
    .maybeSingle()
  assertNoError(liteError, 'load canonical inbound email (descriptor-only fallback)')
  if (!lite) throw new Error(`Company Update source email ${emailId} was not found in fund ${fundId}.`)

  const count = Math.min(Number(lite.attachments_count ?? 0), MAX_LITE_ATTACHMENTS)
  const attachments: NonNullable<PostmarkPayload['Attachments']> = []
  for (let index = 0; index < count; index++) {
    const { data: descriptor, error: descriptorError } = await supabase
      .from('inbound_emails')
      .select(ATTACHMENT_FIELDS.map(field => `${field}:raw_payload->Attachments->${index}->${field}`).join(', '))
      .eq('id', emailId)
      .eq('fund_id', fundId)
      .maybeSingle()
    assertNoError(descriptorError, `load attachment ${index} descriptor`)
    if (!descriptor?.Name) break
    attachments.push({
      Name: String(descriptor.Name),
      ContentType: String(descriptor.ContentType ?? ''),
      ContentLength: Number(descriptor.ContentLength ?? 0),
      ...(descriptor.StoragePath ? { StoragePath: String(descriptor.StoragePath) } : {}),
      ContentError:
        descriptor.ContentError
          ? String(descriptor.ContentError)
          : descriptor.StoragePath
            ? undefined
            : 'Attachment bytes are embedded inline in the stored email and are too large to load; the original was never written to storage.',
    })
  }

  const payload: PostmarkPayload = {
    From: lite.p_From ?? lite.from_address,
    To: lite.p_To ?? '',
    ...(lite.p_FromFull ? { FromFull: lite.p_FromFull } : {}),
    ...(lite.p_OriginalRecipient ? { OriginalRecipient: lite.p_OriginalRecipient } : {}),
    ...(lite.p_Date ? { Date: lite.p_Date } : {}),
    ...(lite.p_Subject ? { Subject: lite.p_Subject } : {}),
    ...(lite.p_TextBody ? { TextBody: lite.p_TextBody } : {}),
    ...(lite.p_HtmlBody ? { HtmlBody: lite.p_HtmlBody } : {}),
    ...(lite.p_MessageID ? { MessageID: lite.p_MessageID } : {}),
    Attachments: attachments,
  }
  return {
    id: lite.id,
    fund_id: lite.fund_id,
    company_id: lite.company_id,
    from_address: lite.from_address,
    subject: lite.subject,
    received_at: lite.received_at,
    routed_to: lite.routed_to,
    raw_payload: payload,
  }
}

/** Remove an email from the reporting projection when its effective route changes. */
export async function removeCompanyUpdate(
  supabase: SupabaseAdmin,
  params: { emailId: string; fundId: string },
): Promise<void> {
  const { error } = await supabase
    .from('company_updates')
    .delete()
    .eq('source_email_id', params.emailId)
    .eq('fund_id', params.fundId)
  assertNoError(error, 'remove email from Company Updates')
}

/** Copy an already-produced configured-metric reporting period without making another AI call. */
export async function updateCompanyUpdatePeriod(
  supabase: SupabaseAdmin,
  params: { emailId: string; fundId: string; period: ReportingPeriod },
): Promise<void> {
  if (params.period.confidence === 'low') return
  const { error } = await supabase
    .from('company_updates')
    .update({
      period_label: params.period.label,
      period_year: params.period.year,
      period_quarter: params.period.quarter,
      period_month: params.period.month,
      period_source: 'configured_metric_extraction',
      updated_at: new Date().toISOString(),
    })
    .eq('source_email_id', params.emailId)
    .eq('fund_id', params.fundId)
  assertNoError(error, 'copy reporting period to Company Update')
}

function resolveStoredAttachment(
  emailId: string,
  runtimeIndex: number,
  attachment: StoredAttachment,
  canonical: StoredAttachment[],
): { attachment: StoredAttachment; storagePath: string | null; ordinal: number } {
  const directPath = attachment.StoragePath ?? null
  if (directPath) {
    const stored = canonical.find(candidate => candidate.StoragePath === directPath) ?? attachment
    return { attachment: stored, storagePath: directPath, ordinal: ordinalFromPath(emailId, directPath) ?? runtimeIndex }
  }

  const byOrdinal = canonical.find(candidate =>
    candidate.StoragePath && ordinalFromPath(emailId, candidate.StoragePath) === runtimeIndex,
  )
  if (byOrdinal?.StoragePath) return { attachment: byOrdinal, storagePath: byOrdinal.StoragePath, ordinal: runtimeIndex }

  const samePosition = canonical[runtimeIndex]
  if (
    samePosition?.StoragePath &&
    samePosition.Name === attachment.Name &&
    samePosition.ContentLength === attachment.ContentLength
  ) {
    return {
      attachment: samePosition,
      storagePath: samePosition.StoragePath,
      ordinal: ordinalFromPath(emailId, samePosition.StoragePath) ?? runtimeIndex,
    }
  }
  return { attachment: samePosition ?? attachment, storagePath: null, ordinal: runtimeIndex }
}

function ordinalFromPath(emailId: string, storagePath: string): number | null {
  const escaped = emailId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const ordinal = new RegExp(`^${escaped}/(\\d+)_`).exec(storagePath)?.[1]
  return ordinal === undefined ? null : Number.parseInt(ordinal, 10)
}

function senderAttribution(
  fromAddress: string,
  payload: PostmarkPayload,
): { name: string | null; email: string } {
  const email = extractEmail(fromAddress)
  const name = payload.FromFull?.Name?.trim() || extractName(fromAddress)
  return { name: name || null, email }
}

function extractEmail(value: string): string {
  return (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase()
}

function extractName(value: string): string {
  if (!value.includes('<')) return ''
  return value.replace(/<[^>]+>/, '').trim().replace(/^["']|["']$/g, '')
}

export function overallStatus(
  bodyStatus: 'complete' | 'partial' | 'failed',
  artifactStatuses: ExtractionStatus[],
): 'complete' | 'partial' | 'failed' {
  const statuses = [bodyStatus, ...artifactStatuses]
  if (statuses.every(status => status === 'complete')) return 'complete'
  const hasUsableContent = statuses.some(status => status === 'complete' || status === 'partial')
  return hasUsableContent ? 'partial' : 'failed'
}

function chunkRow(
  chunk: ExtractedArtifact['chunks'][number],
  kind: 'subject' | 'artifact_title' | 'body_original' | 'body_current' | 'attachment',
  parserVersion: string,
) {
  return {
    chunk_kind: kind,
    ordinal: chunk.ordinal,
    locator: chunk.locator,
    content: chunk.text,
    parser_version: parserVersion,
  }
}

function assertNoError(error: { message?: string } | null | undefined, operation: string): void {
  if (error) throw new Error(`Could not ${operation}: ${error.message ?? 'database error'}`)
}
