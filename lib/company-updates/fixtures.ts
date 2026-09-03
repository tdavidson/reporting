/**
 * Programmatic, sanitized fixtures for the Company Updates verification corpus.
 *
 * Every fixture is generated in-process so nothing resembling a real portfolio update is checked
 * in, yet each one reproduces a structural property the spec calls out: HTML-only bodies,
 * forwarded and wholly-quoted messages, selectable and scanned PDFs, wide/model/hidden/duplicate
 * sheets, DOCX headings and tables, PPTX slides with notes, CSV, text, images, duplicate filenames,
 * extensionless and generic-MIME files, corrupt files, and deliberate resource-limit cases.
 *
 * Test-only module; nothing here runs in production.
 */
import JSZip from 'jszip'
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import * as XLSX from 'xlsx'

// ─── PDF ──────────────────────────────────────────────────────────────────────────────────────

/** A one-page PDF whose only content stream draws `text` (empty text = image-only page). */
export function minimalPdf(text: string): Buffer {
  return multiPagePdf([text])
}

/** One page per entry; an empty entry is a page with no text layer (a "scanned" page). */
export function multiPagePdf(pages: string[]): Buffer {
  const objects: string[] = []
  const pageIds: number[] = []
  // 1 = catalog, 2 = pages, 3 = font; pages and streams follow.
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push('') // placeholder for /Pages
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (const text of pages) {
    const escaped = text.replace(/([\\()])/g, '\\$1')
    const stream = text ? `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET` : ''
    const contentId = objects.length + 2
    const pageId = objects.length + 1
    pageIds.push(pageId)
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`)
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

/** A PDF header followed by garbage: the signature says PDF, the parser cannot open it. */
export function corruptPdf(): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('this is not a pdf object graph at all\n'.repeat(40))])
}

/** A valid PDF cut off part-way through its xref table. */
export function truncatedPdf(): Buffer {
  const whole = minimalPdf('Truncated before the trailer')
  return whole.subarray(0, whole.length - 60)
}

// ─── Images ───────────────────────────────────────────────────────────────────────────────────

/** A minimal valid 1×1 PNG. Enough for signature detection; carries no text, so OCR is queued. */
export function pngBytes(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  )
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────────────────────

export interface DocxSpec {
  blocks: Array<
    | { heading: string }
    | { paragraph: string }
    | { bullets: string[] }
    | { table: string[][] }
  >
}

export async function docxBytes(spec: DocxSpec): Promise<Buffer> {
  const children = spec.blocks.flatMap(block => {
    if ('heading' in block) return [new Paragraph({ text: block.heading, heading: HeadingLevel.HEADING_1 })]
    if ('paragraph' in block) return [new Paragraph({ children: [new TextRun(block.paragraph)] })]
    if ('bullets' in block) return block.bullets.map(text => new Paragraph({ text, bullet: { level: 0 } }))
    return [
      new Table({
        rows: block.table.map(cells => new TableRow({ children: cells.map(cell => new TableCell({ children: [new Paragraph(cell)] })) })),
      }),
    ]
  })
  const document = new Document({ sections: [{ children }] })
  return Packer.toBuffer(document)
}

/** A zip that claims to be DOCX but whose document part is not XML we can walk. */
export async function corruptDocx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>unterminated')
  return zip.generateAsync({ type: 'nodebuffer' })
}

// ─── PPTX ─────────────────────────────────────────────────────────────────────────────────────

export interface PptxSpec {
  slides: Array<{ paragraphs: string[]; notes?: string[]; table?: string[][] }>
}

export async function pptxBytes(spec: PptxSpec): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('ppt/presentation.xml', '<p:presentation xmlns:p="p"/>')
  spec.slides.forEach((slide, index) => {
    const n = index + 1
    const paragraphs = slide.paragraphs
      .map(text => `<a:p>${text.split('\n').map((run, i) => `${i ? '<a:br/>' : ''}<a:r><a:t>${escapeXml(run)}</a:t></a:r>`).join('')}</a:p>`)
      .join('')
    const table = slide.table
      ? `<a:tbl>${slide.table.map(row => `<a:tr>${row.map(cell => `<a:tc><a:txBody><a:p><a:r><a:t>${escapeXml(cell)}</a:t></a:r></a:p></a:txBody></a:tc>`).join('')}</a:tr>`).join('')}</a:tbl>`
      : ''
    zip.file(`ppt/slides/slide${n}.xml`, `<p:sld xmlns:p="p" xmlns:a="a"><p:txBody>${paragraphs}</p:txBody>${table}</p:sld>`)
    if (slide.notes) {
      const notes = slide.notes.map(text => `<a:p><a:r><a:t>${escapeXml(text)}</a:t></a:r></a:p>`).join('')
      zip.file(`ppt/notesSlides/notesSlide${n}.xml`, `<p:notes xmlns:p="p" xmlns:a="a">${notes}</p:notes>`)
    }
  })
  return zip.generateAsync({ type: 'nodebuffer' })
}

// ─── Spreadsheets ─────────────────────────────────────────────────────────────────────────────

export interface SheetSpec {
  name: string
  rows: unknown[][]
  hidden?: 0 | 1 | 2
  formulas?: Record<string, string>
}

export function workbookBytes(sheets: SheetSpec[], bookType: 'xlsx' | 'csv' = 'xlsx'): Buffer {
  const workbook = XLSX.utils.book_new()
  const visibility: Array<{ Hidden: 0 | 1 | 2 }> = []
  for (const spec of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(spec.rows)
    for (const [cell, formula] of Object.entries(spec.formulas ?? {})) {
      sheet[cell] = { ...(sheet[cell] ?? { t: 'n', v: 0 }), f: formula }
      // Keep the declared range honest so a formula cell below the data is still inside it.
      const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1')
      const target = XLSX.utils.decode_cell(cell)
      range.e.r = Math.max(range.e.r, target.r)
      range.e.c = Math.max(range.e.c, target.c)
      sheet['!ref'] = XLSX.utils.encode_range(range)
    }
    XLSX.utils.book_append_sheet(workbook, sheet, spec.name)
    visibility.push({ Hidden: spec.hidden ?? 0 })
  }
  workbook.Workbook = { Sheets: visibility }
  return XLSX.write(workbook, { type: 'buffer', bookType }) as Buffer
}

/** A zip with a workbook part that SheetJS cannot parse. */
export async function corruptXlsx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', 'not xml')
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row><c r="A1"><v>1</v></c>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** A wide sheet: `columns` columns × `rows` rows of numbers. */
export function wideSheet(name: string, rows: number, columns: number): SheetSpec {
  const header = Array.from({ length: columns }, (_, c) => `Col${c + 1}`)
  const body = Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => r * columns + c))
  return { name, rows: [header, ...body] }
}

// ─── Email bodies ─────────────────────────────────────────────────────────────────────────────

export const EMAIL_BODIES = {
  plain: {
    TextBody: 'Team,\n\nQ2 was strong. Net revenue retention reached 118% and we closed two enterprise logos.\n\nCash: $4.2M, runway 18 months.\n\nBest,\nAda',
  },
  htmlOnly: {
    HtmlBody: '<html><body><p>Highlights</p><ul><li>NRR 118%</li><li>Two enterprise logos</li></ul><p>Cash <b>$4.2M</b></p></body></html>',
  },
  gmailReply: {
    TextBody: 'Thanks — noted on the hiring plan.\n\nOn Tue, Aug 4, 2026 at 9:12 AM Ada Founder <ada@example.test> wrote:\n> Hiring plan attached. We are pausing sales hires.\n> Churn was 1.1%.',
  },
  outlookReply: {
    TextBody: 'Confirming receipt.\n\nFrom: Ada Founder\nSent: Tuesday, August 4, 2026 9:12 AM\nTo: Fund Team\nSubject: RE: July update\n\nJuly ARR $1.35M, churn 1.1%.',
  },
  forwarded: {
    TextBody: 'FYI from the founder.\n\n---------- Forwarded message ---------\nFrom: Ada Founder <ada@example.test>\nDate: Tue, Aug 4, 2026\nSubject: July update\n\nJuly ARR $1.35M, churn 1.1%. Customer retention rose to 96 percent.',
  },
  whollyQuoted: {
    TextBody: 'On Tue, Aug 4, 2026 Ada Founder <ada@example.test> wrote:\n> Entire update lives in the quote.\n> Retention 96 percent.',
  },
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
