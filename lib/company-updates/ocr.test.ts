import { describe, expect, it } from 'vitest'
import { OCR_PARSER_VERSION, ocrImage, ocrPdf, parsePageDelimited, runOcrBatch, type OcrEngine } from './ocr'
import { minimalPdf, pngBytes } from './fixtures'

function fakeEngine(overrides: Partial<OcrEngine> = {}): OcrEngine {
  return {
    name: 'fake-ocr',
    transcribeImage: async () => 'Cash balance $4.2M\nRunway 18 months',
    transcribePdfPages: async (_buffer, pages) => Object.fromEntries(pages.map(page => [page, `OCR text for page ${page}: retention 96 percent`])),
    ...overrides,
  }
}

function fakeAdmin(claimed: any[], options: { applyError?: string } = {}) {
  const applies: any[] = []
  return {
    applies,
    client: {
      from() { throw new Error('unexpected table access') },
      async rpc(name: string, args: any) {
        if (name === 'company_update_ocr_claim') return { data: claimed, error: null }
        if (name === 'company_update_artifact_apply_ocr') {
          applies.push(args)
          return { data: null, error: options.applyError ? { message: options.applyError } : null }
        }
        throw new Error(`unexpected rpc ${name}`)
      },
      storage: {
        from() {
          return {
            async download(path: string) {
              const bytes = path.endsWith('.pdf') ? minimalPdf('') : pngBytes()
              return { data: new Blob([new Uint8Array(bytes)]), error: null }
            },
          }
        },
      },
    },
  }
}

describe('Company Update OCR path', () => {
  it('transcribes an image and applies a complete result with OCR-labelled chunks', async () => {
    const parsed = await ocrImage(pngBytes(), 'image/png', fakeEngine())
    expect(parsed.status).toBe('complete')
    expect(parsed.text).toContain('Runway 18 months')
    expect(parsed.chunks[0].locator).toMatchObject({ image: true, ocr: true })
    expect(parsed.metadata).toMatchObject({ ocrUsed: true, ocrEngine: 'fake-ocr' })
  })

  it('keeps an image visible as not_applicable when OCR finds nothing', async () => {
    const parsed = await ocrImage(pngBytes(), 'image/png', fakeEngine({ transcribeImage: async () => '' }))
    expect(parsed.status).toBe('not_applicable')
    expect(parsed.warnings[0]).toMatch(/no readable text/)
  })

  it('merges OCR pages into a scanned PDF and marks them in text and locators', async () => {
    const artifact = { id: 'a1', fund_id: 'f1', update_id: 'u1', filename: 'scan.pdf', detected_content_type: 'application/pdf', declared_content_type: null, storage_path: 'e/0_scan.pdf', ocr_attempts: 1, metadata: {} }
    const parsed = await ocrPdf(minimalPdf(''), artifact, fakeEngine())
    expect(parsed.status).toBe('complete')
    expect(parsed.text).toContain('[Page 1 (OCR)]')
    expect(parsed.chunks[0].locator).toMatchObject({ page: 1, ocr: true })
    expect(parsed.metadata).toMatchObject({ ocrUsed: true, ocrPages: [1], ocrNeededPages: [] })
  })

  it('records pages OCR could not read instead of calling the document complete', async () => {
    const artifact = { id: 'a1', fund_id: 'f1', update_id: 'u1', filename: 'scan.pdf', detected_content_type: 'application/pdf', declared_content_type: null, storage_path: 'e/0_scan.pdf', ocr_attempts: 1, metadata: {} }
    const parsed = await ocrPdf(minimalPdf(''), artifact, fakeEngine({ transcribePdfPages: async () => ({}) }))
    expect(parsed.status).toBe('failed')
    expect(parsed.warnings.join(' ')).toMatch(/OCR found no readable text on page 1/)
  })

  it('claims pending work and applies results through the atomic RPC with the OCR parser version', async () => {
    const admin = fakeAdmin([
      { id: 'img', fund_id: 'f1', update_id: 'u1', filename: 'chart.png', detected_content_type: 'image/png', declared_content_type: null, storage_path: 'e/0_chart.png', ocr_attempts: 1, metadata: { ocrNeeded: true } },
    ])
    const result = await runOcrBatch(admin.client as any, { engine: async () => fakeEngine() })
    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0, retried: 0 })
    expect(admin.applies[0]).toMatchObject({
      p_fund_id: 'f1',
      p_artifact_id: 'img',
      p_patch: { ocr_status: 'complete', extraction_status: 'complete', parser_version: OCR_PARSER_VERSION },
    })
    expect(admin.applies[0].p_chunks[0]).toMatchObject({ chunk_kind: 'attachment', parser_version: OCR_PARSER_VERSION })
  })

  it('returns a failed engine call to the queue until attempts are exhausted, then marks it failed', async () => {
    const broken = fakeEngine({ transcribeImage: async () => { throw new Error('provider down') } })
    const first = fakeAdmin([{ id: 'img', fund_id: 'f1', update_id: 'u1', filename: 'c.png', detected_content_type: 'image/png', declared_content_type: null, storage_path: 'e/0_c.png', ocr_attempts: 1, metadata: {} }])
    const r1 = await runOcrBatch(first.client as any, { engine: async () => broken })
    expect(r1).toMatchObject({ retried: 1, failed: 0 })
    expect(first.applies[0].p_patch).toMatchObject({ ocr_status: 'pending', ocr_error: 'provider down' })

    const last = fakeAdmin([{ id: 'img', fund_id: 'f1', update_id: 'u1', filename: 'c.png', detected_content_type: 'image/png', declared_content_type: null, storage_path: 'e/0_c.png', ocr_attempts: 3, metadata: {} }])
    const r3 = await runOcrBatch(last.client as any, { engine: async () => broken })
    expect(r3).toMatchObject({ retried: 0, failed: 1 })
    expect(last.applies[0].p_patch).toMatchObject({ ocr_status: 'failed', ocr_error: 'provider down' })
  })

  it('fails permanently when the bytes were never stored', async () => {
    const admin = fakeAdmin([{ id: 'x', fund_id: 'f1', update_id: 'u1', filename: 'c.png', detected_content_type: 'image/png', declared_content_type: null, storage_path: null, ocr_attempts: 3, metadata: {} }])
    const result = await runOcrBatch(admin.client as any, { engine: async () => fakeEngine() })
    expect(result.details[0]).toMatchObject({ outcome: 'failed', error: expect.stringMatching(/not stored/) })
  })

  it('parses page-delimited transcription output and ignores pages it did not ask for', () => {
    const parsed = parsePageDelimited('preamble\n=== PAGE 2 ===\nTwo\n=== PAGE 3 ===\n[NO TEXT]\n=== PAGE 9 ===\nNine', [2, 3])
    expect(parsed).toEqual({ 2: 'Two', 3: '' })
  })
})
