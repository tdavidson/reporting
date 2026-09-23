import { describe, it, expect } from 'vitest'
import { onboardingReminders, type OnboardingData } from './onboarding'

const empty: OnboardingData = { closings: [], awaitingReview: [], expiring: [] }

describe('onboardingReminders — closings', () => {
  const closing = { id: 'c1', name: 'Second Close', vehicle: 'Fund I', closeDate: '2026-10-15', incomplete: ['Acme Capital LP', 'Beta Trust'], total: 5 }

  it('opens two weeks out and names who is incomplete', () => {
    expect(onboardingReminders({ ...empty, closings: [closing] }, '2026-10-01')).toEqual([{
      source: 'onboarding',
      keys: ['ob:close:c1:2026-10-15:t14'],
      title: 'Second Close — Fund I: 2 of 5 entities not complete',
      detail: 'Still outstanding: Acme Capital LP, Beta Trust',
      dueDate: '2026-10-15',
      state: 'upcoming',
      href: '/lp-portal',
    }])
  })

  it('is silent earlier, and silent when everyone is complete', () => {
    expect(onboardingReminders({ ...empty, closings: [closing] }, '2026-09-20')).toEqual([])
    expect(onboardingReminders({ ...empty, closings: [{ ...closing, incomplete: [] }] }, '2026-10-14')).toEqual([])
  })

  it('crosses each threshold on the way in, and nags weekly once passed', () => {
    expect(onboardingReminders({ ...empty, closings: [closing] }, '2026-10-13')[0].keys).toEqual(['ob:close:c1:2026-10-15:t14', 'ob:close:c1:2026-10-15:t7', 'ob:close:c1:2026-10-15:t3'])
    const late = onboardingReminders({ ...empty, closings: [closing] }, '2026-10-30')[0]
    expect(late.keys).toContain('ob:close:c1:2026-10-15:od2')
    expect(late.state).toBe('overdue')
  })

  it('re-arms when the closing date moves', () => {
    const moved = onboardingReminders({ ...empty, closings: [{ ...closing, closeDate: '2026-10-20' }] }, '2026-10-13')[0]
    expect(moved.keys).toEqual(['ob:close:c1:2026-10-20:t14', 'ob:close:c1:2026-10-20:t7'])
  })
})

describe('onboardingReminders — uploads awaiting review', () => {
  const upload = { itemId: 'i1', entity: 'Acme Capital LP', kindLabel: 'Subscription agreement', submittedOn: '2026-09-20' }

  it('is silent for the first three days, then due', () => {
    expect(onboardingReminders({ ...empty, awaitingReview: [upload] }, '2026-09-22')).toEqual([])
    expect(onboardingReminders({ ...empty, awaitingReview: [upload] }, '2026-09-23')).toEqual([{
      source: 'onboarding',
      keys: ['ob:review:i1:2026-09-20:t0'],
      title: 'Subscription agreement from Acme Capital LP awaiting review',
      detail: 'Uploaded 2026-09-20',
      dueDate: '2026-09-23',
      state: 'due_soon',
      href: '/lp-portal',
    }])
  })

  it('a re-upload is a new reminder, not a repeat of the old one', () => {
    const again = onboardingReminders({ ...empty, awaitingReview: [{ ...upload, submittedOn: '2026-09-25' }] }, '2026-09-28')[0]
    expect(again.keys).toEqual(['ob:review:i1:2026-09-25:t0'])
  })
})

describe('onboardingReminders — expiring documents', () => {
  const w8 = { itemId: 'i9', entity: 'Beta Trust', kindLabel: 'Tax form (W-9 / W-8)', expiresOn: '2026-12-31' }

  it('flags ninety days out and again at thirty', () => {
    expect(onboardingReminders({ ...empty, expiring: [w8] }, '2026-09-01')).toEqual([])
    const first = onboardingReminders({ ...empty, expiring: [w8] }, '2026-10-05')[0]
    expect(first.keys).toEqual(['ob:expire:i9:2026-12-31:t90'])
    expect(first.title).toBe('Tax form (W-9 / W-8) for Beta Trust expires')
    expect(onboardingReminders({ ...empty, expiring: [w8] }, '2026-12-10')[0].keys).toEqual(['ob:expire:i9:2026-12-31:t90', 'ob:expire:i9:2026-12-31:t30'])
  })

  it('says so once it has lapsed', () => {
    const lapsed = onboardingReminders({ ...empty, expiring: [w8] }, '2027-01-10')[0]
    expect(lapsed.title).toBe('Tax form (W-9 / W-8) for Beta Trust has expired')
    expect(lapsed.state).toBe('overdue')
  })
})
