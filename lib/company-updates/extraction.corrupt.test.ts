import { describe, expect, it } from 'vitest'
import { extractArtifact, MAX_ARTIFACT_BYTES } from './extraction'
import { corruptDocx, corruptPdf, corruptXlsx, truncatedPdf, wideSheet, workbookBytes } from './fixtures'

/**
 * Corrupt files and deliberate resource-limit cases. The contract under test: nothing here may
 * come back as an empty `complete` document. A file we cannot read is `failed` with a reason; a
 * file we deliberately stop reading is `partial` with the skipped range recorded.
 */
describe('corrupt attachments become failed results with a reason', () => {
  it('PDF signature with no object graph', async () => {
    const extracted = await extractArtifact({ filename: 'deck.pdf', declaredContentType: 'application/pdf', content: corruptPdf().toString('base64') })
    expect(extracted.detectedContentType).toBe('application/pdf')
    expect(extracted.result.status).toBe('failed')
    expect(extracted.result.parser).toBe('parser')
    expect(extracted.result.warnings.at(-1)).toMatch(/^Extraction failed: /)
    expect(extracted.result.chunks).toEqual([])
  })

  it('PDF truncated before its trailer', async () => {
    const extracted = await extractArtifact({ filename: 'update.pdf', declaredContentType: 'application/pdf', content: truncatedPdf().toString('base64') })
    // pdf.js can sometimes recover a damaged file; either way the outcome is explicit.
    expect(['failed', 'complete', 'partial']).toContain(extracted.result.status)
    if (extracted.result.status !== 'failed') expect(extracted.result.text).toContain('Truncated before the trailer')
    else expect(extracted.result.warnings.at(-1)).toMatch(/Extraction failed/)
  })

  it('DOCX whose document part is broken XML', async () => {
    const extracted = await extractArtifact({ filename: 'memo.docx', content: (await corruptDocx()).toString('base64') })
    expect(extracted.detectedContentType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(extracted.result.status).not.toBe('complete')
    // Whatever text could be recovered is labelled partial, never complete.
    if (extracted.result.status === 'partial') expect(extracted.result.warnings.join(' ')).toMatch(/not preserved|could not/)
  })

  it('XLSX whose workbook part is not XML', async () => {
    const extracted = await extractArtifact({ filename: 'model.xlsx', content: (await corruptXlsx()).toString('base64') })
    expect(extracted.detectedContentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(['failed', 'partial']).toContain(extracted.result.status)
    if (extracted.result.status === 'failed') expect(extracted.result.warnings.at(-1)).toMatch(/Extraction failed/)
  })

  it('zip that is not an Office document is not_applicable, not empty success', async () => {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    zip.file('readme.txt', 'inside an archive')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    const extracted = await extractArtifact({ filename: 'bundle.zip', content: bytes.toString('base64') })
    expect(extracted.detectedContentType).toBe('application/zip')
    expect(extracted.result.status).toBe('not_applicable')
    expect(extracted.result.warnings[0]).toMatch(/No deterministic text parser/)
  })

  it('invalid base64 is a decoder failure', async () => {
    const extracted = await extractArtifact({ filename: 'x.pdf', declaredContentType: 'application/pdf', content: '!!!not base64!!!' })
    expect(extracted.result.status).toBe('failed')
    expect(extracted.result.parser).toBe('base64-decoder')
  })

  it('an empty file is a failure with its size stated', async () => {
    const extracted = await extractArtifact({ filename: 'empty.txt', declaredContentType: 'text/plain', content: '' })
    expect(extracted.result.status).toBe('failed')
    // Empty `content` is indistinguishable from "bytes unavailable" at the payload level.
    expect(extracted.result.warnings[0]).toMatch(/unavailable|empty/)
  })

  it('a valid base64 payload decoding to zero bytes is a failure', async () => {
    const extracted = await extractArtifact({ filename: 'empty.txt', declaredContentType: 'text/plain', content: '====' })
    expect(extracted.result.status).toBe('failed')
  })

  it('text with invalid UTF-8 is partial with the replacement count', async () => {
    const bytes = Buffer.concat([Buffer.from('ARR grew '), Buffer.from([0xff, 0xfe]), Buffer.from(' to $1.2M')])
    const extracted = await extractArtifact({ filename: 'notes.txt', declaredContentType: 'text/plain', content: bytes.toString('base64') })
    expect(extracted.result.status).toBe('partial')
    expect(extracted.result.warnings[0]).toMatch(/replacement character/)
    expect(extracted.result.text).toContain('to $1.2M')
  })
})

describe('resource limits become partial results with the skipped range recorded', () => {
  it('refuses bytes over the artifact limit with an explicit reason', async () => {
    // A base64 string that decodes to MAX + 1 bytes without allocating that much in the test.
    const chunk = Buffer.alloc(3 * 1024 * 1024, 0x41).toString('base64')
    const content = chunk.repeat(Math.ceil((MAX_ARTIFACT_BYTES + 1) / (3 * 1024 * 1024)))
    const extracted = await extractArtifact({ filename: 'huge.txt', declaredContentType: 'text/plain', content })
    expect(extracted.result.status).toBe('failed')
    expect(extracted.result.parser).toBe('size-limit')
    expect(extracted.result.warnings[0]).toMatch(/extraction limit is/)
    expect(extracted.byteSize).toBeGreaterThan(MAX_ARTIFACT_BYTES)
  }, 30_000)

  it('a wide sheet beyond the column cap keeps every column it read and names the ones it skipped', async () => {
    const bytes = workbookBytes([wideSheet('Wide', 3, 230)])
    const extracted = await extractArtifact({ filename: 'wide.xlsx', content: bytes.toString('base64') })
    expect(extracted.result.status).toBe('partial')
    expect(extracted.result.warnings.join(' ')).toMatch(/columns GS-HV were skipped/)
    expect(extracted.result.text).toContain('GR=Col200')
    expect(extracted.result.text).not.toContain('Col201')
    expect(extracted.result.metadata).toMatchObject({ sheets: [expect.objectContaining({ extractedRange: 'A1:GR4' })] })
  })

  it('a workbook beyond the cell budget records which sheets were cut or skipped', async () => {
    // 3 sheets × 1,000 rows × 200 columns = 600k cells > the 400k budget.
    const bytes = workbookBytes([wideSheet('One', 1_000, 200), wideSheet('Two', 1_000, 200), wideSheet('Three', 1_000, 200)])
    const extracted = await extractArtifact({ filename: 'model.xlsx', content: bytes.toString('base64') })
    expect(extracted.result.status).toBe('partial')
    const warnings = extracted.result.warnings.join('\n')
    expect(warnings).toMatch(/Sheet "One" was limited to rows|Sheet "Two" was limited to rows/)
    expect(warnings).toMatch(/Sheet "Three" was skipped/)
    expect(extracted.result.text).toContain('[Sheet: One | Visibility: visible]')
    expect(extracted.result.text).not.toContain('[Sheet: Three')
    expect(extracted.result.metadata).toMatchObject({
      sheets: expect.arrayContaining([expect.objectContaining({ name: 'Three', skipped: true })]),
    })
  }, 60_000)

  it('sheet limits do not truncate a chunk mid-row', async () => {
    const bytes = workbookBytes([wideSheet('Tall', 2_500, 8)])
    const extracted = await extractArtifact({ filename: 'tall.xlsx', content: bytes.toString('base64') })
    expect(extracted.result.status).toBe('complete')
    for (const chunk of extracted.result.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(12_000)
      expect(chunk.locator).toMatchObject({ sheet: 'Tall', rowStart: expect.any(Number), rowEnd: expect.any(Number) })
      const lastLine = chunk.text.split('\n').at(-1)!
      expect(lastLine).toMatch(/^Row \d+: /)
    }
    const covered = extracted.result.chunks.map(c => [c.locator.rowStart as number, c.locator.rowEnd as number])
    expect(covered[0][0]).toBe(1)
    expect(covered.at(-1)![1]).toBe(2_501)
  })
})
