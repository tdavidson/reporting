import mammoth from 'mammoth'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { createAdminClient } from '@/lib/supabase/admin'
import { scanFile } from '@/lib/security/scan-file'

const MAX_CHARS = 50_000

// Postmark inbound attachment shape
interface PostmarkAttachment {
  Name: string
  ContentType: string
  Content?: string // base64-encoded — absent when stored in Storage
  ContentLength: number
  StoragePath?: string // path in email-attachments bucket
  ContentError?: string // why source bytes were deliberately not persisted
}

// Postmark inbound payload (fields relevant to extraction)
export interface PostmarkPayload {
  TextBody?: string
  HtmlBody?: string
  Attachments?: PostmarkAttachment[]
}

/**
 * Reconstitute full attachment content by downloading from Supabase Storage.
 * - If `Content` is already present (legacy data) → kept as-is
 * - If `StoragePath` is present → download from `email-attachments` bucket, base64-encode
 * Returns a new payload with Content populated on every attachment.
 */
export async function hydrateAttachments(
  payload: PostmarkPayload
): Promise<PostmarkPayload> {
  if (!payload.Attachments || payload.Attachments.length === 0) return payload

  const needsHydration = payload.Attachments.some(a => !a.Content && a.StoragePath)
  if (!needsHydration) return payload

  const admin = createAdminClient()
  const hydrated = await Promise.all(
    payload.Attachments.map(async (att) => {
      if (att.Content) return att
      if (!att.StoragePath) return att

      const { data, error } = await admin.storage
        .from('email-attachments')
        .download(att.StoragePath)

      if (error || !data) {
        console.error(`[hydrateAttachments] Failed to download ${att.StoragePath}:`, error)
        return att
      }

      const buffer = Buffer.from(await data.arrayBuffer())
      return { ...att, Content: buffer.toString('base64') }
    })
  )

  return { ...payload, Attachments: hydrated }
}

export interface AttachmentResult {
  filename: string
  contentType: string
  extractedText: string   // empty string for PDF and images
  skipped: boolean
  skipReason?: string
  base64Content?: string  // set for PDF and images — passed to Claude natively
}

export interface ExtractionResult {
  emailBody: string
  attachments: AttachmentResult[]
}

export async function extractAttachmentText(
  payload: PostmarkPayload
): Promise<ExtractionResult> {
  const emailBody = payload.TextBody?.trim() || stripHtml(payload.HtmlBody || '')

  const attachments: AttachmentResult[] = []
  for (const attachment of payload.Attachments ?? []) {
    attachments.push(await extractSingle(attachment))
  }

  return { emailBody, attachments }
}

/**
 * Extract text from a raw buffer + filename (used for uploaded documents).
 * Reuses the same extraction logic as Postmark attachments.
 */
export async function extractFromBuffer(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<AttachmentResult> {
  const base64 = buffer.toString('base64')
  return extractSingle({
    Name: filename,
    ContentType: contentType,
    Content: base64,
    ContentLength: buffer.length,
  })
}

// ---------------------------------------------------------------------------
// Per-attachment dispatcher
// ---------------------------------------------------------------------------

async function extractSingle(attachment: PostmarkAttachment): Promise<AttachmentResult> {
  const { Name: filename, ContentType: contentType, Content: base64 } = attachment
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''

  if (!base64) {
    return {
      filename,
      contentType,
      extractedText: '',
      skipped: true,
      skipReason: attachment.ContentError ?? 'No content available (attachment may not have been hydrated)',
    }
  }

  // Safety net: scan file before processing
  const scanBuffer = Buffer.from(base64, 'base64')
  const scanResult = scanFile(scanBuffer, filename, contentType)
  if (!scanResult.safe) {
    return {
      filename,
      contentType,
      extractedText: '',
      skipped: true,
      skipReason: scanResult.reason,
    }
  }

  try {
    // PDF — pass to Claude natively as base64
    if (isPdf(contentType, ext)) {
      return { filename, contentType, extractedText: '', skipped: false, base64Content: base64 }
    }

    // Images — pass to Claude natively as base64
    if (isImage(contentType, ext)) {
      return { filename, contentType, extractedText: '', skipped: false, base64Content: base64 }
    }

    // DOCX
    if (isDocx(contentType, ext)) {
      const text = await extractDocx(base64)
      return { filename, contentType, extractedText: truncate(text, filename), skipped: false }
    }

    // PPTX
    if (isPptx(contentType, ext)) {
      const text = await extractPptx(base64)
      return { filename, contentType, extractedText: truncate(text, filename), skipped: false }
    }

    // XLSX
    if (isXlsx(contentType, ext)) {
      const text = extractXlsx(base64)
      return { filename, contentType, extractedText: truncate(text, filename), skipped: false }
    }

    // CSV — SheetJS handles it; decode base64 first since it arrives as text
    if (isCsv(contentType, ext)) {
      const csvText = Buffer.from(base64, 'base64').toString('utf-8')
      const text = csvToMarkdown(csvText)
      return { filename, contentType, extractedText: truncate(text, filename), skipped: false }
    }

    return {
      filename,
      contentType,
      extractedText: '',
      skipped: true,
      skipReason: `Unsupported file type: ${contentType || ext || 'unknown'}`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      filename,
      contentType,
      extractedText: '',
      skipped: true,
      skipReason: `Extraction failed: ${message}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Format extractors
// ---------------------------------------------------------------------------

async function extractDocx(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64')
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

async function extractPptx(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64')
  const zip = await JSZip.loadAsync(buffer)

  // PPTX stores slides at ppt/slides/slide{n}.xml — sort numerically
  const slideEntries = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const n = (s: string) => parseInt(s.match(/slide(\d+)\.xml$/)![1])
      return n(a) - n(b)
    })

  const slideTexts: string[] = []
  for (let i = 0; i < slideEntries.length; i++) {
    const xml = await zip.files[slideEntries[i]].async('string')
    // <a:t> elements hold all visible text in DrawingML
    const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? []
    const text = matches
      .map(tag => tag.replace(/<[^>]+>/g, ''))
      .filter(t => t.trim())
      .join(' ')
    if (text.trim()) {
      slideTexts.push(`[Slide ${i + 1}]\n${text}`)
    }
  }

  return slideTexts.join('\n\n')
}

function extractXlsx(base64: string): string {
  const buffer = Buffer.from(base64, 'base64')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  return sheetsToMarkdown(workbook)
}

function csvToMarkdown(csv: string): string {
  const workbook = XLSX.read(csv, { type: 'string' })
  return sheetsToMarkdown(workbook)
}

function sheetsToMarkdown(workbook: XLSX.WorkBook): string {
  const tables: string[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' })
    if (rows.length === 0) continue

    const mdRows: string[] = []
    rows.forEach((row, i) => {
      const cells = row.map(cell => String(cell ?? '').replace(/\|/g, '\\|'))
      mdRows.push(`| ${cells.join(' | ')} |`)
      if (i === 0) {
        mdRows.push(`| ${cells.map(() => '---').join(' | ')} |`)
      }
    })

    tables.push(`**Sheet: ${sheetName}**\n\n${mdRows.join('\n')}`)
  }

  return tables.join('\n\n')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, filename: string): string {
  if (text.length > MAX_CHARS) {
    console.warn(
      `[extractAttachmentText] "${filename}" truncated from ${text.length} to ${MAX_CHARS} characters`
    )
    return text.slice(0, MAX_CHARS)
  }
  return text
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Content-type checks fall back to file extension for reliability,
// since senders occasionally set incorrect MIME types.

function isPdf(ct: string, ext: string): boolean {
  return ct === 'application/pdf' || ext === 'pdf'
}

function isImage(ct: string, ext: string): boolean {
  return (
    ct.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)
  )
}

function isDocx(ct: string, ext: string): boolean {
  return (
    ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ct === 'application/msword' ||
    ext === 'docx' ||
    ext === 'doc'
  )
}

function isPptx(ct: string, ext: string): boolean {
  return (
    ct === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ct === 'application/vnd.ms-powerpoint' ||
    ext === 'pptx' ||
    ext === 'ppt'
  )
}

function isXlsx(ct: string, ext: string): boolean {
  return (
    ct === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ct === 'application/vnd.ms-excel' ||
    ext === 'xlsx' ||
    ext === 'xls'
  )
}

function isCsv(ct: string, ext: string): boolean {
  return ct === 'text/csv' || ct === 'application/csv' || ext === 'csv'
}
