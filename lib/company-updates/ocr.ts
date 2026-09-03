import type { AIProvider } from '@/lib/ai/types'
import { getFeatureProvider } from '@/lib/ai/feature-provider'
import { logAIUsage } from '@/lib/ai/usage'
import {
  ARTIFACT_PARSER_VERSION,
  assemblePdfPages,
  chunkText,
  normalizePlainText,
  type ParsedContent,
} from './extraction'

/**
 * The observable OCR path for Company Update artifacts.
 *
 * Capture never runs OCR inline: an image or a scanned PDF page is recorded with
 * `ocr_status = 'pending'` and a durable warning, so the timeline shows "queued for OCR" instead
 * of "empty". This worker claims pending artifacts (SKIP LOCKED, bounded attempts), transcribes
 * them, and merges the text back through `company_update_artifact_apply_ocr` so the artifact, its
 * chunks and the update's completeness change in one transaction.
 *
 * The engine is pluggable. The default transcribes with the fund's configured `portfolio` vision
 * model under a verbatim-transcription instruction — OCR, not interpretation. Nothing the model
 * says beyond the page text is stored: no summary, no sentiment, no classification.
 */
export interface OcrEngine {
  name: string
  transcribeImage(buffer: Buffer, mediaType: string): Promise<string>
  /** Returns page number → text for exactly the requested pages (missing pages count as failed). */
  transcribePdfPages(buffer: Buffer, pages: number[]): Promise<Record<number, string>>
}

export const OCR_MAX_ATTEMPTS = 3
export const OCR_PARSER_VERSION = `${ARTIFACT_PARSER_VERSION}+ocr-v1`

type OcrAdmin = {
  from: (table: any) => any
  rpc: (...args: any[]) => any
  storage: { from: (bucket: string) => { download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }> } }
}

export interface ClaimedArtifact {
  id: string
  fund_id: string
  update_id: string
  ordinal: number
  attachment_key: string
  filename: string
  detected_content_type: string | null
  declared_content_type: string | null
  storage_path: string | null
  ocr_attempts: number
  metadata: Record<string, unknown> | null
}

export interface OcrBatchResult {
  claimed: number
  completed: number
  failed: number
  retried: number
  details: Array<{ artifactId: string; outcome: 'complete' | 'failed' | 'retry' | 'no_text'; error?: string }>
}

/** Process up to `limit` pending artifacts. Safe to run concurrently from several workers. */
export async function runOcrBatch(
  admin: OcrAdmin,
  options: { limit?: number; fundId?: string; engine?: (fundId: string) => Promise<OcrEngine>; now?: () => Date } = {},
): Promise<OcrBatchResult> {
  const { data: claimed, error } = await admin.rpc('company_update_ocr_claim', {
    p_limit: options.limit ?? 5,
    p_fund_id: options.fundId ?? null,
  })
  if (error) throw new Error(`Could not claim OCR work: ${error.message}`)
  const artifacts = (claimed ?? []) as ClaimedArtifact[]
  const result: OcrBatchResult = { claimed: artifacts.length, completed: 0, failed: 0, retried: 0, details: [] }
  const engines = new Map<string, OcrEngine>()

  for (const artifact of artifacts) {
    try {
      let engine = engines.get(artifact.fund_id)
      if (!engine) {
        engine = await (options.engine ?? createVisionOcrEngine)(artifact.fund_id)
        engines.set(artifact.fund_id, engine)
      }
      const outcome = await ocrOneArtifact(admin, artifact, engine)
      result.details.push({ artifactId: artifact.id, outcome })
      if (outcome === 'complete' || outcome === 'no_text') result.completed++
      else result.failed++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const exhausted = artifact.ocr_attempts >= OCR_MAX_ATTEMPTS
      const { error: applyError } = await admin.rpc('company_update_artifact_apply_ocr', {
        p_fund_id: artifact.fund_id,
        p_artifact_id: artifact.id,
        p_patch: exhausted
          ? { ocr_status: 'failed', ocr_error: message }
          : { ocr_status: 'pending', ocr_error: message },
        p_chunks: null,
      })
      if (applyError) console.error(`[company-updates/ocr] Could not record failure for ${artifact.id}:`, applyError.message)
      if (exhausted) result.failed++
      else result.retried++
      result.details.push({ artifactId: artifact.id, outcome: exhausted ? 'failed' : 'retry', error: message })
    }
  }
  return result
}

async function ocrOneArtifact(admin: OcrAdmin, artifact: ClaimedArtifact, engine: OcrEngine): Promise<'complete' | 'no_text'> {
  const buffer = await loadArtifactBytes(admin, artifact)
  const contentType = artifact.detected_content_type ?? artifact.declared_content_type ?? ''

  let parsed: ParsedContent
  if (contentType === 'application/pdf') {
    parsed = await ocrPdf(buffer, artifact, engine)
  } else if (contentType.startsWith('image/')) {
    parsed = await ocrImage(buffer, contentType, engine)
  } else {
    throw new Error(`OCR is not applicable to ${contentType || 'an unknown content type'}.`)
  }

  const { error: applyError } = await admin.rpc('company_update_artifact_apply_ocr', {
    p_fund_id: artifact.fund_id,
    p_artifact_id: artifact.id,
    p_patch: {
      extracted_text: parsed.text,
      extraction_status: parsed.status,
      warnings: parsed.warnings,
      metadata: { ...(artifact.metadata ?? {}), ...parsed.metadata },
      parser: parsed.parser,
      parser_version: OCR_PARSER_VERSION,
      extraction_error: parsed.status === 'failed' ? parsed.warnings[parsed.warnings.length - 1] ?? 'OCR produced no text.' : null,
      ocr_status: 'complete',
      ocr_error: null,
    },
    p_chunks: parsed.chunks.map(chunk => ({
      chunk_kind: 'attachment',
      ordinal: chunk.ordinal,
      locator: chunk.locator,
      content: chunk.text,
      parser_version: OCR_PARSER_VERSION,
    })),
  })
  if (applyError) throw new Error(`Could not apply OCR result: ${applyError.message}`)
  return parsed.text ? 'complete' : 'no_text'
}

/**
 * The artifact's original bytes: from storage when the attachment was written there, otherwise
 * from the base64 Content still inline in the source email's stored payload (older ingestion kept
 * it there). Only the one attachment's Content is selected, by ordinal, so a large email does not
 * have to be served whole.
 */
export async function loadArtifactBytes(admin: OcrAdmin, artifact: ClaimedArtifact): Promise<Buffer> {
  if (artifact.storage_path) {
    const { data, error } = await admin.storage.from('email-attachments').download(artifact.storage_path)
    if (error || !data) throw new Error(`Could not download ${artifact.storage_path}: ${error?.message ?? 'no data'}`)
    return Buffer.from(await data.arrayBuffer())
  }
  const { data: update } = await admin
    .from('company_updates')
    .select('source_email_id')
    .eq('id', artifact.update_id)
    .eq('fund_id', artifact.fund_id)
    .maybeSingle()
  const emailId = (update as { source_email_id?: string } | null)?.source_email_id
  if (!emailId) throw new Error('Source bytes are not stored and the source email could not be found.')
  const { data: inline, error } = await admin
    .from('inbound_emails')
    .select(`content:raw_payload->Attachments->${artifact.ordinal}->>Content, name:raw_payload->Attachments->${artifact.ordinal}->>Name`)
    .eq('id', emailId)
    .eq('fund_id', artifact.fund_id)
    .maybeSingle()
  if (error) throw new Error(`Could not read inline attachment bytes: ${error.message}`)
  const row = inline as { content?: string | null; name?: string | null } | null
  if (!row?.content || row.name !== artifact.filename) {
    throw new Error('Source bytes are not stored; OCR cannot run on a descriptor-only attachment.')
  }
  return Buffer.from(row.content.replace(/\s/g, ''), 'base64')
}

export async function ocrImage(buffer: Buffer, mediaType: string, engine: OcrEngine): Promise<ParsedContent> {
  const text = normalizePlainText(await engine.transcribeImage(buffer, mediaType))
  const metadata = { ocrNeeded: true, ocrUsed: true, ocrEngine: engine.name }
  if (!text) {
    return {
      text: '',
      status: 'not_applicable',
      parser: engine.name,
      warnings: ['OCR found no readable text in this image; the original remains available.'],
      metadata,
      chunks: [],
    }
  }
  return {
    text,
    status: 'complete',
    parser: engine.name,
    warnings: [],
    metadata,
    chunks: chunkText(text, { image: true, ocr: true }),
  }
}

export async function ocrPdf(buffer: Buffer, artifact: ClaimedArtifact, engine: OcrEngine): Promise<ParsedContent> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const doc = await getDocumentProxy(new Uint8Array(buffer))
  const extracted = await extractText(doc)
  const pages = extracted.text.map(normalizePlainText)
  const before = assemblePdfPages(pages, extracted.totalPages)
  const needed = (before.metadata.ocrNeededPages as number[]) ?? []
  if (needed.length === 0) return before

  const transcribed = await engine.transcribePdfPages(buffer, needed)
  const merged = pages.slice()
  const ocrPages: number[] = []
  const missing: number[] = []
  for (const page of needed) {
    const text = normalizePlainText(transcribed[page] ?? '')
    if (text) {
      merged[page - 1] = text
      ocrPages.push(page)
    } else {
      missing.push(page)
    }
  }
  const after = assemblePdfPages(merged, extracted.totalPages, { ocrPages, ocrEngine: engine.name })
  if (missing.length) {
    after.warnings = [
      ...after.warnings.filter(w => !w.startsWith('PDF pages requiring OCR')),
      `OCR found no readable text on page${missing.length === 1 ? '' : 's'} ${missing.join(', ')}.`,
    ]
  }
  return after
}

// ─── Default engine: the fund's vision model as a transcriber ───────────────────────────────────

const TRANSCRIBE_SYSTEM =
  'You are an OCR engine. Transcribe the visible text of the supplied material VERBATIM, preserving ' +
  'reading order, line breaks, table rows (cells separated by " | "), numbers and units exactly as ' +
  'printed. Do not summarize, interpret, translate, correct, or add commentary. If there is no ' +
  'readable text, output exactly: [NO TEXT]'

export async function createVisionOcrEngine(fundId: string, deps?: { admin?: any }): Promise<OcrEngine> {
  const admin = deps?.admin ?? (await import('@/lib/supabase/admin')).createAdminClient()
  const { provider, providerType, model } = await getFeatureProvider(admin, fundId, 'portfolio')
  return visionEngine(provider, { providerType, model, fundId, admin })
}

export function visionEngine(
  provider: Pick<AIProvider, 'createMessage'>,
  ctx: { providerType: string; model: string; fundId: string; admin: any },
): OcrEngine {
  const log = async (usage: { inputTokens: number; outputTokens: number }) => {
    await logAIUsage(ctx.admin, { fundId: ctx.fundId, provider: ctx.providerType, model: ctx.model, feature: 'company_updates_ocr', usage })
  }
  return {
    name: `vision-ocr:${ctx.providerType}:${ctx.model}`,
    async transcribeImage(buffer, mediaType) {
      const result = await provider.createMessage({
        model: ctx.model,
        maxTokens: 8_000,
        system: TRANSCRIBE_SYSTEM,
        content: [
          { type: 'image', mediaType, data: buffer.toString('base64') },
          { type: 'text', text: 'Transcribe this image.' },
        ],
      })
      await log(result.usage)
      if (result.truncated) throw new Error('OCR output was truncated by the model token limit.')
      return stripNoText(result.text)
    },
    async transcribePdfPages(buffer, pages) {
      const result = await provider.createMessage({
        model: ctx.model,
        maxTokens: 16_000,
        system: TRANSCRIBE_SYSTEM,
        content: [
          { type: 'document', mediaType: 'application/pdf', data: buffer.toString('base64') },
          {
            type: 'text',
            text:
              `Transcribe ONLY page${pages.length === 1 ? '' : 's'} ${pages.join(', ')} of this document. ` +
              'Start each page with a line of exactly the form "=== PAGE <n> ===" and nothing else on that line. ' +
              'Output every requested page even if it is blank (use [NO TEXT] for its body).',
          },
        ],
      })
      await log(result.usage)
      if (result.truncated) throw new Error('OCR output was truncated by the model token limit.')
      return parsePageDelimited(result.text, pages)
    },
  }
}

function stripNoText(text: string): string {
  return /^\s*\[NO TEXT\]\s*$/i.test(text) ? '' : text
}

/** Parse "=== PAGE n ===" delimited output into page → text, ignoring pages that were not asked for. */
export function parsePageDelimited(output: string, wanted: number[]): Record<number, string> {
  const result: Record<number, string> = {}
  const want = new Set(wanted)
  const parts = output.split(/^\s*=+\s*PAGE\s+(\d+)\s*=+\s*$/im)
  // parts: [preamble, n1, text1, n2, text2, ...]
  for (let index = 1; index + 1 < parts.length; index += 2) {
    const page = Number.parseInt(parts[index], 10)
    if (!want.has(page)) continue
    result[page] = stripNoText(parts[index + 1].replace(/^\n+|\n+$/g, ''))
  }
  return result
}
