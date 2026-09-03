import { describe, it, expect } from 'vitest'
import { buildK1Html, type K1PdfData } from './k1-pdf'
import { emptyLines } from '@/lib/accounting/k1-allocation'

function data(over: Partial<K1PdfData> = {}): K1PdfData {
  return {
    fundName: 'Redwood Ventures',
    fundLogo: null,
    fundAddress: null,
    vehicle: 'Fund I',
    taxYear: 2026,
    version: 1,
    status: 'final',
    partnerName: 'Alice Chen',
    lines: emptyLines(),
    capitalAccount: { beginning: 0, contributions: 0, distributions: 0, netIncome: 0, ending: 0 },
    ...over,
  }
}

describe('buildK1Html', () => {
  it('says on its face that it is not an IRS form', () => {
    // Producing a facsimile of Schedule K-1 would invite it to be filed as one. The document
    // has to name itself.
    const html = buildK1Html(data())
    expect(html).toContain('not an IRS form')
    expect(html).toContain("Partner's tax information")
  })

  it('names the box beside every line', () => {
    const html = buildK1Html(data())
    expect(html).toContain('9a')
    expect(html).toContain('Net long-term capital gain (loss)')
  })

  it('annotates a subset line as included in its parent box', () => {
    // The one mistake a reader makes here is adding 6b to the line above it.
    const html = buildK1Html(data())
    expect(html).toContain('included in box 6a')
    expect(html).toContain('included in box 8')
  })

  it('formats a loss in parentheses and a zero as a dash', () => {
    const lines = emptyLines()
    lines.longTermGain = -250_000
    const html = buildK1Html(data({ lines }))
    expect(html).toContain('(250,000.00)')
    expect(html).toContain('—')
  })

  it('shows withdrawals as a negative in item L', () => {
    const html = buildK1Html(
      data({ capitalAccount: { beginning: 1_000_000, contributions: 0, distributions: 250_000, netIncome: 0, ending: 750_000 } }),
    )
    expect(html).toContain('(250,000.00)')
  })

  it('marks a draft, so an unissued figure cannot be mistaken for a final one', () => {
    const html = buildK1Html(data({ status: 'draft' }))
    expect(html).toContain('<strong>Draft.</strong>')
    expect(html).toContain('may change')
  })

  it('does not mark a final package as a draft', () => {
    expect(buildK1Html(data({ status: 'final' }))).not.toContain('<strong>Draft.</strong>')
  })

  it('says an amendment supersedes what went before', () => {
    const html = buildK1Html(data({ version: 2 }))
    expect(html).toContain('Amended')
    expect(html).toContain('supersedes')
  })

  it('shows the name on the form when it differs from the fund’s record', () => {
    const html = buildK1Html(data({ partnerName: 'Alice Chen', legalName: 'Chen Family Trust' }))
    expect(html).toContain('on file as Chen Family Trust')
  })

  it('does not repeat the name when the two agree', () => {
    const html = buildK1Html(data({ partnerName: 'Alice Chen', legalName: 'Alice Chen' }))
    expect(html).not.toContain('on file as')
  })

  it('identifies the partner by TIN last four, never the whole number', () => {
    const html = buildK1Html(data({ tinLast4: '4821' }))
    expect(html).toContain('TIN ending 4821')
  })

  it('prints the package notes rather than withholding them', () => {
    // A partner whose figures carry a caveat should see it on the document, not learn it later.
    const html = buildK1Html(data({ notes: ['Long-term gain includes 400,000 on assets held under three years.'] }))
    expect(html).toContain('assets held under three years')
  })

  it('escapes a partner name that contains markup', () => {
    const html = buildK1Html(data({ partnerName: '<script>alert(1)</script>' }))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('states that capital is on a tax basis, since that is not what the LP statement shows', () => {
    const html = buildK1Html(data())
    expect(html).toContain('tax basis')
  })
})
