import { describe, it, expect } from 'vitest'
import { complianceReminders, type ComplianceData, type ComplianceItemRow } from './compliance'

const adv: ComplianceItemRow = {
  id: 'form-adv', name: 'Form ADV Annual Amendment', short_name: 'Form ADV',
  frequency: 'Annual', scope: 'firm', deadline_month: 3, deadline_day: 31, rolling_days: null,
}
const soi: ComplianceItemRow = {
  id: 'valuations-soi', name: 'Valuations & Schedule of Investments', short_name: 'Valuations',
  frequency: 'Quarterly', scope: 'firm', deadline_month: null, deadline_day: null, rolling_days: null,
}

const data = (o: Partial<ComplianceData> = {}): ComplianceData => ({
  items: [adv],
  profile: null,
  settings: [{ compliance_item_id: 'form-adv', portfolio_group: '', applies: 'yes', dismissed: false }],
  closed: [],
  portfolioGroups: [],
  closeDates: {},
  ...o,
})

describe('complianceReminders', () => {
  it('emits an applicable item inside the 30-day window with the crossed keys', () => {
    expect(complianceReminders(data(), '2027-03-17')).toEqual([{
      source: 'compliance',
      keys: ['c:form-adv::2027-03-31:t30', 'c:form-adv::2027-03-31:t14'],
      title: 'Form ADV Annual Amendment',
      detail: undefined,
      dueDate: '2027-03-31',
      state: 'upcoming',
      href: '/compliance',
    }])
  })

  it('is silent more than 30 days out', () => {
    expect(complianceReminders(data(), '2027-02-01')).toEqual([])
  })

  it("last year's filing does not suppress this year's", () => {
    const closed = [{ compliance_item_id: 'form-adv', portfolio_group: '', quarter: 0, year: 2026 }]
    expect(complianceReminders(data({ closed }), '2027-03-17')).toHaveLength(1)
  })

  it("this year's filing suppresses it", () => {
    const closed = [{ compliance_item_id: 'form-adv', portfolio_group: '', quarter: 0, year: 2027 }]
    expect(complianceReminders(data({ closed }), '2027-03-17')).toEqual([])
  })

  it('needs an explicit or evaluated "applies" — needs_review is not enough', () => {
    expect(complianceReminders(data({ settings: [] }), '2027-03-17')).toEqual([])
  })

  it('skips dismissed items', () => {
    const settings = [{ compliance_item_id: 'form-adv', portfolio_group: '', applies: 'yes', dismissed: true }]
    expect(complianceReminders(data({ settings }), '2027-03-17')).toEqual([])
  })

  it('keeps an overdue item with weekly overdue keys', () => {
    const [item] = complianceReminders(data(), '2027-04-15')
    expect(item.state).toBe('overdue')
    expect(item.keys.slice(-3)).toEqual(['c:form-adv::2027-03-31:t0', 'c:form-adv::2027-03-31:od1', 'c:form-adv::2027-03-31:od2'])
  })

  it('drops an occurrence more than 90 days overdue', () => {
    expect(complianceReminders(data(), '2027-06-29').map(i => i.dueDate)).toEqual(['2027-03-31'])
    expect(complianceReminders(data(), '2027-07-01')).toEqual([])
  })

  it("catches last year's Q4 occurrence in January", () => {
    const settings = [{ compliance_item_id: 'valuations-soi', portfolio_group: 'Q4', applies: 'yes', dismissed: false }]
    const items = complianceReminders(data({ items: [soi], settings }), '2027-01-05')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ dueDate: '2026-12-31', detail: 'Q4', state: 'overdue' })
    expect(items[0].keys[0]).toBe('c:valuations-soi:Q4:2026-12-31:t30')
  })

  it('labels vehicle-scoped quarterly items with the vehicle and quarter', () => {
    const item = { ...soi, scope: 'vehicle' as const }
    const settings = [{ compliance_item_id: 'valuations-soi', portfolio_group: 'Fund II::Q3', applies: 'yes', dismissed: false }]
    const items = complianceReminders(data({ items: [item], settings, portfolioGroups: ['Fund II'] }), '2026-09-20')
    expect(items.map(i => i.detail)).toEqual(['Fund II · Q3'])
  })
})
