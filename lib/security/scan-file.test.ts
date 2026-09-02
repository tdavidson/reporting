import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { scanFileAsync } from './scan-file'

/**
 * SEC-008, the fail-open half.
 *
 * Every archive-bomb check — entry count, uncompressed size, compression ratio — ran inside a
 * `try` whose `catch` was empty, and the function then returned `{ safe: true }`. So the one input
 * that defeated the analysis was the one input the analysis approved: hand it a ZIP crafted to
 * break the parser and it came back clean, having checked nothing.
 */

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function realZip(
  files: Record<string, string>,
  compression: 'STORE' | 'DEFLATE' = 'STORE',
): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return zip.generateAsync({ type: 'nodebuffer', compression })
}

describe('scanFileAsync on ZIP-based files', () => {
  it('accepts an ordinary archive', async () => {
    const buffer = await realZip({ 'word/document.xml': '<w:document/>' })
    expect(await scanFileAsync(buffer, 'report.docx', DOCX)).toEqual({ safe: true })
  })

  it('REFUSES a ZIP it cannot parse, instead of calling it safe', async () => {
    // A file that declares itself a ZIP by magic bytes and is then garbage. The old code caught
    // the parse error, did nothing, and returned safe.
    const broken = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('not actually a zip, and deliberately so'),
    ])
    const result = await scanFileAsync(broken, 'report.docx', DOCX)
    expect(result.safe).toBe(false)
    expect(result.reason).toMatch(/could not be parsed/i)
  })

  it('refuses a truncated archive — the common way a parser is broken by accident', async () => {
    const whole = await realZip({ 'a.txt': 'x'.repeat(5000) })
    const truncated = whole.subarray(0, Math.floor(whole.length / 2))
    expect((await scanFileAsync(truncated, 'a.zip', 'application/zip')).safe).toBe(false)
  })

  it('refuses an archive whose compression ratio is implausible', async () => {
    // DEFLATE, explicitly: JSZip's default is STORE, so a "bomb" built without this is just a
    // large file with a 1:1 ratio and passes — correctly. The bomb is the RATIO, not the size.
    const bomb = await realZip({ 'big.txt': '\0'.repeat(60 * 1024 * 1024) }, 'DEFLATE')
    const result = await scanFileAsync(bomb, 'bomb.zip', 'application/zip')
    expect(result.safe).toBe(false)
    expect(result.reason).toMatch(/ratio|uncompressed/i)
  })

  it('does not apply archive analysis to a file that is not ZIP-based', async () => {
    expect(await scanFileAsync(Buffer.from('plain text'), 'notes.txt', 'text/plain')).toEqual({ safe: true })
  })
})
