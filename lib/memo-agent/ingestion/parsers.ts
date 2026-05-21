import { extractText as extractPlainText } from '@/lib/memo-agent/extract-text'
import { extractFromBuffer } from '@/lib/parsing/extractAttachmentText'
import type { IngestionFileSource } from './sources'

export interface TranscriptTurn {
  speaker: string | null
  start_ms: number
  end_ms: number
  text: string
}

export interface ParsedFile {
  document_id: string
  file_name: string
  file_format: string
  detected_type: string | null
  /** Plain text extracted from the file, suitable for direct prompt inclusion. Empty for PDFs/images. */
  text: string
  /** Base64 content when the AI provider should ingest it natively (PDFs, images). */
  base64: string | null
  /** MIME type for native ingestion. */
  media_type: string | null
  /** Per-file errors that didn't fail the whole run. */
  errors: string[]
}

/**
 * Parse a single deal-room file.
 *
 *   PDF / image                → base64 + media_type, no text (AI ingests natively)
 *   DOCX / PPTX / XLSX / CSV   → text, via the shared extractFromBuffer helper
 *                                so diligence ingest stays aligned with the
 *                                inbound-email parser (markdown tables for
 *                                xlsx, slide-numbered text for pptx, etc.)
 *   VTT / SRT                  → text, parsed into timestamped speaker turns
 *   MD / TXT                   → text (utf-8 decode)
 */
export async function parseFile(source: IngestionFileSource): Promise<ParsedFile> {
  const errors: string[] = []
  const fmt = source.file_format.toLowerCase()

  const out: ParsedFile = {
    document_id: source.document_id,
    file_name: source.file_name,
    file_format: fmt,
    detected_type: source.detected_type,
    text: '',
    base64: null,
    media_type: null,
    errors,
  }

  try {
    if (fmt === 'pdf') {
      out.base64 = source.buffer.toString('base64')
      out.media_type = 'application/pdf'
      // Also pull plain text as a fallback / for indexing — don't fail if it errors.
      const text = await extractPlainText(source.buffer, 'pdf').catch(() => null)
      if (text) out.text = text
      return out
    }

    if (fmt === 'png' || fmt === 'jpg' || fmt === 'jpeg' || fmt === 'webp' || fmt === 'gif') {
      out.base64 = source.buffer.toString('base64')
      out.media_type = `image/${fmt === 'jpg' ? 'jpeg' : fmt}`
      return out
    }

    if (fmt === 'md' || fmt === 'markdown' || fmt === 'txt') {
      out.text = source.buffer.toString('utf8')
      return out
    }

    // Call-transcript subtitle formats — parsed into unified speaker turns
    // and rendered as timestamped plain text for the ingest stage.
    if (fmt === 'vtt') {
      out.text = formatTurns(parseVtt(source.buffer.toString('utf8')))
      return out
    }
    if (fmt === 'srt') {
      out.text = formatTurns(parseSrt(source.buffer.toString('utf8')))
      return out
    }

    // Office formats + CSV — delegate to the shared extractor. ContentType is
    // passed empty so the helper falls back to the filename extension, which
    // we trust here (file_format comes from upload validation).
    if (['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'csv'].includes(fmt)) {
      const result = await extractFromBuffer(source.buffer, source.file_name, '')
      if (result.skipped) {
        errors.push(result.skipReason ?? `extractFromBuffer skipped ${fmt}`)
      } else {
        out.text = result.extractedText
      }
      return out
    }

    errors.push(`Unsupported format: ${fmt}`)
    return out
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
    return out
  }
}

export async function parseAll(sources: IngestionFileSource[]): Promise<ParsedFile[]> {
  return Promise.all(sources.map(parseFile))
}

// ---------------------------------------------------------------------------
// VTT / SRT transcript parsers — accept either format and emit unified turns
// with speaker labels and millisecond offsets.
// ---------------------------------------------------------------------------

const TIMESTAMP_VTT = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{3})/
const VTT_VOICE_TAG = /<v\s+([^>]+)>/i

export function parseVtt(content: string): TranscriptTurn[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const turns: TranscriptTurn[] = []
  let i = 0
  // Skip WEBVTT header and any NOTE blocks.
  while (i < lines.length && !lines[i].includes('-->')) i++

  while (i < lines.length) {
    const line = lines[i]
    if (!line.includes('-->')) { i++; continue }
    const [startStr, endStr] = line.split('-->').map(s => s.trim().split(' ')[0])
    const start_ms = parseTimestamp(startStr)
    const end_ms = parseTimestamp(endStr)
    i++
    const textLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '') { textLines.push(lines[i]); i++ }
    const raw = textLines.join(' ').trim()
    if (raw) {
      const voiceMatch = raw.match(VTT_VOICE_TAG)
      const speaker = voiceMatch ? voiceMatch[1].trim() : null
      const text = raw.replace(VTT_VOICE_TAG, '').replace(/<\/v>/gi, '').replace(/<[^>]+>/g, '').trim()
      if (text) turns.push({ speaker, start_ms, end_ms, text })
    }
    i++
  }
  return turns
}

export function parseSrt(content: string): TranscriptTurn[] {
  const blocks = content.replace(/\r\n/g, '\n').split(/\n\n+/)
  const turns: TranscriptTurn[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim() !== '')
    if (lines.length < 2) continue
    // First line might be a numeric index; the timing line contains "-->".
    const timingIdx = lines.findIndex(l => l.includes('-->'))
    if (timingIdx === -1) continue
    const [startStr, endStr] = lines[timingIdx].split('-->').map(s => s.trim().split(' ')[0])
    const start_ms = parseTimestamp(startStr)
    const end_ms = parseTimestamp(endStr)
    const raw = lines.slice(timingIdx + 1).join(' ').trim()
    if (!raw) continue
    // SRT speaker convention is "SPEAKER: text" — pull it out when present.
    const speakerMatch = raw.match(/^([A-Za-z][A-Za-z0-9 _.'-]{0,40}):\s+(.*)$/)
    const speaker = speakerMatch ? speakerMatch[1].trim() : null
    const text = (speakerMatch ? speakerMatch[2] : raw).replace(/<[^>]+>/g, '').trim()
    if (text) turns.push({ speaker, start_ms, end_ms, text })
  }
  return turns
}

function parseTimestamp(str: string): number {
  const m = str.match(TIMESTAMP_VTT)
  if (!m) return 0
  const hours = m[1] ? parseInt(m[1].replace(':', ''), 10) : 0
  const minutes = parseInt(m[2], 10)
  const seconds = parseInt(m[3], 10)
  const millis = parseInt(m[4], 10)
  return ((hours * 3600 + minutes * 60 + seconds) * 1000) + millis
}

function formatTurns(turns: TranscriptTurn[]): string {
  // Plain-text rendering the AI ingest stage can read as-is. Timestamps are
  // included so cited claims can point back to a moment in the call.
  return turns.map(t => {
    const ts = formatMs(t.start_ms)
    const speaker = t.speaker ? `${t.speaker}: ` : ''
    return `[${ts}] ${speaker}${t.text}`
  }).join('\n')
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
