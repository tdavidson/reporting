import mammoth from 'mammoth'

/**
 * Plain-text extraction for files whose text is going into a system prompt
 * (style anchors, schema-doc references, etc).
 *
 * Differs from `lib/parsing/extractAttachmentText.ts` in two ways:
 *   1. Output is just `string` (no rich result, no provenance).
 *   2. PDFs are extracted locally via `unpdf` rather than passed to an AI
 *      provider's native PDF handling. We want the bytes once, cached on the
 *      row, not re-shipped on every prompt.
 *
 * Supported: PDF, DOCX, MD/TXT. Returns null when extraction fails.
 */
export async function extractText(buffer: Buffer, fileFormat: string): Promise<string | null> {
  const fmt = fileFormat.toLowerCase()
  try {
    if (fmt === 'pdf') return await extractPdf(buffer)
    if (fmt === 'docx' || fmt === 'doc') return await extractDocx(buffer)
    if (fmt === 'md' || fmt === 'markdown' || fmt === 'txt') return buffer.toString('utf8')
  } catch (err) {
    console.error(`[memo-agent.extract-text] ${fmt} extraction failed:`, err)
  }
  return null
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return (result.value ?? '').trim()
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // unpdf is a small ESM-only PDF text extractor. Lazy-loaded so the import
  // doesn't break callers that never touch PDFs.
  const { extractText: unpdfExtract, getDocumentProxy } = await import('unpdf')
  const doc = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await unpdfExtract(doc, { mergePages: true })
  return (Array.isArray(text) ? text.join('\n\n') : (text ?? '')).trim()
}
