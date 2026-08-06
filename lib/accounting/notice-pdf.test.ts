import { describe, it, expect } from 'vitest'
import { buildNoticeHtml, type NoticeData } from './notice-pdf'

const base: NoticeData = {
  kind: 'capital_call',
  fundName: 'Example Fund',
  fundLogo: null,
  fundAddress: null,
  currency: 'USD',
  vehicle: 'Acme SPV LP',
  partnerName: 'Jane Partner',
  noticeDate: '2026-03-01',
  amount: 25_000,
}

describe('buildNoticeHtml — capital call', () => {
  it('leads with the amount due and the deadline', () => {
    const html = buildNoticeHtml({ ...base, dueDate: '2026-03-15' })
    expect(html).toContain('Capital Call Notice')
    expect(html).toContain('Amount due from you')
    expect(html).toContain('$25,000.00')
    expect(html).toContain('2026-03-15')
  })

  it('prints wire instructions verbatim, newlines preserved', () => {
    const html = buildNoticeHtml({ ...base, wireInstructions: 'Bank of Nowhere\nAcct 12345678' })
    expect(html).toContain('Payment instructions')
    expect(html).toContain('Bank of Nowhere')
    expect(html).toContain('white-space:pre-line')
  })

  it('says instructions are coming rather than looking complete without them', () => {
    // A demand for money with nowhere to send it should admit that on its face.
    const html = buildNoticeHtml(base)
    expect(html).toContain('Payment instructions will be provided separately')
  })

  it('escapes partner and fund names', () => {
    const html = buildNoticeHtml({ ...base, partnerName: 'Smith & Sons <Trust>' })
    expect(html).toContain('Smith &amp; Sons &lt;Trust&gt;')
    expect(html).not.toContain('<Trust>')
  })

  it('uses the notice date, never today — a reissued PDF must not move it', () => {
    const html = buildNoticeHtml({ ...base, noticeDate: '2021-07-04' })
    expect(html).toContain('2021-07-04')
    expect(html).not.toContain(new Date().toISOString().slice(0, 10))
  })

  it('renders the currency symbol for a non-USD fund', () => {
    const html = buildNoticeHtml({ ...base, currency: 'EUR' })
    expect(html).toContain('€25,000.00')
  })
})

describe('buildNoticeHtml — distribution', () => {
  it('reads as money going OUT to the partner', () => {
    const html = buildNoticeHtml({ ...base, kind: 'distribution', amount: 12_500 })
    expect(html).toContain('Distribution Notice')
    expect(html).toContain('Amount payable to you')
    expect(html).toContain('$12,500.00')
  })

  it('carries no payment instructions or due date', () => {
    // Those belong to a demand for money, not a payment of it.
    const html = buildNoticeHtml({ ...base, kind: 'distribution', dueDate: '2026-03-15', wireInstructions: 'Bank of Nowhere' })
    expect(html).not.toContain('Payment instructions')
    expect(html).not.toContain('Bank of Nowhere')
    expect(html).not.toContain('Due <strong>')
  })

  it('shows the capital-account context it was given', () => {
    const html = buildNoticeHtml({
      ...base, kind: 'distribution',
      context: [{ label: 'Capital account balance', value: 400_000 }],
    })
    expect(html).toContain('Your capital account')
    expect(html).toContain('$400,000.00')
  })
})

describe('buildNoticeHtml — shared', () => {
  it('omits the context table entirely when there is none', () => {
    const html = buildNoticeHtml(base)
    expect(html).not.toContain('Your commitment')
  })

  it('numbers the notice when the register carries a sequence', () => {
    expect(buildNoticeHtml({ ...base, number: 3 })).toContain('Capital Call Notice No. 3')
    expect(buildNoticeHtml(base)).not.toContain('No. ')
  })
})
