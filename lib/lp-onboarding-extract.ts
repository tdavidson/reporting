// Text out of an onboarding document, on this server, with nothing sent anywhere.
//
// PDFs go through pdf.js (unpdf's serverless build); Word files through mammoth; images and
// scanned PDFs through Tesseract, which runs here as WebAssembly. Tesseract fetches its English
// language data once per cold start from its CDN — the engine's data, not the document — and
// caches it in the temp directory. A photo it cannot read comes back empty, and the sorter says
// so rather than guessing. The text is used for one classification and then dropped: it is never
// written to the database, which is the rule for every onboarding upload.

import os from 'node:os'
import mammoth from 'mammoth'

/** Enough for a title page, the subscriber block and a signature page; nothing needs more. */
const MAX_CHARS = 40_000
/** Pages of a PDF to read. Sub docs run to 60 pages; the facts are in the first few and the last few. */
const PDF_HEAD_PAGES = 6
const PDF_TAIL_PAGES = 4
/** Only OCR what a phone produces or a scanner emits; anything larger is not a document. */
const MAX_OCR_BYTES = 15 * 1024 * 1024
const OCR_TIMEOUT_MS = 45_000

export type ExtractSource = 'pdf' | 'docx' | 'ocr' | 'none'

export interface Extracted {
  text: string
  source: ExtractSource
  /** Why nothing came back, when that is the case. */
  note: string | null
}

export function isPdf(mime: string | null, name: string): boolean {
  return mime === 'application/pdf' || /\.pdf$/i.test(name)
}
export function isDocx(mime: string | null, name: string): boolean {
  return mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(name)
}
export function isImage(mime: string | null, name: string): boolean {
  return (mime ?? '').startsWith('image/') || /\.(png|jpe?g|heic|webp|tiff?|bmp)$/i.test(name)
}

async function extractPdf(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const { getDocumentProxy, extractText } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const total = pdf.numPages
  // Every page for a short document; head and tail for a long one.
  const wanted = new Set<number>()
  if (total <= PDF_HEAD_PAGES + PDF_TAIL_PAGES) for (let i = 1; i <= total; i++) wanted.add(i)
  else {
    for (let i = 1; i <= PDF_HEAD_PAGES; i++) wanted.add(i)
    for (let i = total - PDF_TAIL_PAGES + 1; i <= total; i++) wanted.add(i)
  }
  const { text } = await extractText(pdf, { mergePages: false })
  const pages = Array.isArray(text) ? text : [String(text)]
  const picked = pages.map((t, i) => ({ n: i + 1, t })).filter(p => wanted.has(p.n)).map(p => p.t)
  return { text: picked.join('\n\n').slice(0, MAX_CHARS), pages: total }
}

let ocrWorker: Promise<any> | null = null
async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = (async () => {
      const { createWorker } = await import('tesseract.js')
      return createWorker('eng', undefined, { cachePath: os.tmpdir(), logger: () => {} })
    })().catch(e => { ocrWorker = null; throw e })
  }
  return ocrWorker
}

async function ocrImage(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_OCR_BYTES) return ''
  const worker = await getOcrWorker()
  const result = await Promise.race([
    worker.recognize(buffer),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('OCR timed out')), OCR_TIMEOUT_MS)),
  ])
  return String(result?.data?.text ?? '').slice(0, MAX_CHARS)
}

/** A PDF's first page rendered to PNG, for a scan with no text layer. */
async function renderFirstPage(buffer: Buffer): Promise<Buffer | null> {
  try {
    const { getDocumentProxy, renderPageAsImage } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    // pdf.js draws onto a canvas; in Node that is a native one, loaded only when a scan needs it.
    const png = await renderPageAsImage(pdf, 1, { scale: 2, canvasImport: () => import('@napi-rs/canvas') })
    return Buffer.from(png)
  } catch {
    return null
  }
}

export async function extractDocumentText(buffer: Buffer, fileName: string, mimeType: string | null): Promise<Extracted> {
  try {
    if (isDocx(mimeType, fileName)) {
      const { value } = await mammoth.extractRawText({ buffer })
      return { text: value.slice(0, MAX_CHARS), source: 'docx', note: null }
    }
    if (isPdf(mimeType, fileName)) {
      const { text } = await extractPdf(buffer)
      if (text.replace(/\s+/g, '').length >= 40) return { text, source: 'pdf', note: null }
      // No text layer: a scan. Read the first page the way a photo is read.
      const png = await renderFirstPage(buffer)
      if (!png) return { text: '', source: 'none', note: 'This PDF has no text layer and its first page could not be rendered for OCR.' }
      try {
        const t = await ocrImage(png)
        return { text: t, source: 'ocr', note: t.trim() ? 'Read by OCR from the first page of a scan; check the details.' : 'A scan the OCR could not read.' }
      } catch (e) {
        return { text: '', source: 'none', note: `OCR unavailable: ${e instanceof Error ? e.message : String(e)}` }
      }
    }
    if (isImage(mimeType, fileName)) {
      try {
        const t = await ocrImage(buffer)
        return { text: t, source: 'ocr', note: t.trim() ? 'Read by OCR from a photo; check the details.' : 'A photo the OCR could not read.' }
      } catch (e) {
        return { text: '', source: 'none', note: `OCR unavailable: ${e instanceof Error ? e.message : String(e)}` }
      }
    }
    return { text: '', source: 'none', note: 'Not a PDF, Word file or image.' }
  } catch (e) {
    return { text: '', source: 'none', note: `Could not read the file: ${e instanceof Error ? e.message : String(e)}` }
  }
}
