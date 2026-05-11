import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import { extractText as extractPlainText } from '@/lib/memo-agent/extract-text'
import type { IngestionFileSource } from './sources'

export interface ParsedFile {
  document_id: string
  file_name: string
  file_format: string
  detected_type: string | null
  /** Plain text extracted from the file, suitable for direct prompt inclusion. Empty for PDFs/images. */
  text: string
  /** Structured representation when applicable (xlsx sheet → rows). */
  structured: unknown | null
  /** Base64 content when the AI provider should ingest it natively (PDFs, images). */
  base64: string | null
  /** MIME type for native ingestion. */
  media_type: string | null
  /** Per-file errors that didn't fail the whole run. */
  errors: string[]
}

/**
 * Parse a single deal-room file. The shape of the return depends on format:
 *
 *   PDF / image    → base64 + media_type, no text (AI provider parses natively)
 *   DOCX           → text (via mammoth)
 *   XLSX / CSV     → text + structured (sheets → 2D arrays)
 *   PPTX           → text (extracted from slide XML — not perfect but usable)
 *   MD / TXT       → text (raw)
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
    structured: null,
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

    if (fmt === 'docx' || fmt === 'doc') {
      const result = await mammoth.extractRawText({ buffer: source.buffer })
      out.text = (result.value ?? '').trim()
      return out
    }

    if (fmt === 'xlsx' || fmt === 'xls' || fmt === 'csv') {
      const wb = XLSX.read(source.buffer, { type: 'buffer' })
      const sheets: Record<string, unknown[][]> = {}
      const textParts: string[] = []
      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name]
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
        sheets[name] = json
        const csv = XLSX.utils.sheet_to_csv(sheet)
        textParts.push(`### Sheet: ${name}\n${csv}`)
      }
      out.text = textParts.join('\n\n')
      out.structured = sheets
      return out
    }

    if (fmt === 'pptx' || fmt === 'ppt') {
      out.text = await extractPptxText(source.buffer).catch(err => {
        errors.push(`pptx text extraction failed: ${err instanceof Error ? err.message : String(err)}`)
        return ''
      })
      return out
    }

    if (fmt === 'md' || fmt === 'markdown' || fmt === 'txt') {
      out.text = source.buffer.toString('utf8')
      return out
    }

    if (fmt === 'png' || fmt === 'jpg' || fmt === 'jpeg' || fmt === 'webp' || fmt === 'gif') {
      out.base64 = source.buffer.toString('base64')
      out.media_type = `image/${fmt === 'jpg' ? 'jpeg' : fmt}`
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
// PPTX text extraction via JSZip — pulls visible text from each slide's XML.
// ---------------------------------------------------------------------------

async function extractPptxText(buffer: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)

  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const an = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] ?? '0', 10)
      const bn = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] ?? '0', 10)
      return an - bn
    })

  const parts: string[] = []
  for (const name of slideFiles) {
    const xml = await zip.files[name].async('string')
    // Extract <a:t>...</a:t> text runs. Quick and dirty but handles the
    // common case (text on slide masters and tables included).
    const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? []
    const text = matches.map(m => m.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, '')).join(' ')
    if (text.trim()) parts.push(text.trim())
  }
  return parts.join('\n\n').trim()
}
