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
 * Supported: PDF, DOCX, XLSX/XLS, MD/TXT. Returns null when extraction fails.
 */
export async function extractText(buffer: Buffer, fileFormat: string): Promise<string | null> {
  const fmt = fileFormat.toLowerCase()
  try {
    if (fmt === 'pdf') return await extractPdf(buffer)
    if (fmt === 'docx' || fmt === 'doc') return await extractDocx(buffer)
    if (fmt === 'xlsx' || fmt === 'xls') return await extractXlsx(buffer)
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

async function extractXlsx(buffer: Buffer): Promise<string> {
  // xlsx (SheetJS) is already a dependency. Lazy-loaded like the PDF path so
  // callers that never touch spreadsheets don't pull it into their bundle.
  // Each sheet is flattened to CSV; multi-sheet workbooks get a `# Sheet` header
  // so the model can tell tabs apart in the prompt.
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const parts: string[] = []
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]).trim()
    if (csv) parts.push(wb.SheetNames.length > 1 ? `# ${name}\n${csv}` : csv)
  }
  return parts.join('\n\n').trim()
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // unpdf is a small ESM-only PDF text extractor. Lazy-loaded so the import
  // doesn't break callers that never touch PDFs.
  const { extractText: unpdfExtract, getDocumentProxy } = await import('unpdf')
  const doc = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await unpdfExtract(doc, { mergePages: true })
  return (Array.isArray(text) ? text.join('\n\n') : (text ?? '')).trim()
}
