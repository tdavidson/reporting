// LP onboarding in the daily digest: a closing approaching with entities still incomplete, an
// upload waiting for the fund to look at it, and a verified document about to lapse.
//
// Closings count down at two weeks, one week and three days, then weekly once passed — the same
// shape as a capital call. An upload is due for review three days after it arrived, and nags
// weekly after that. An expiry is flagged at ninety and thirty days, the window the Tax page
// already uses for a W-8. Keys embed the date each is measured against, so a moved closing or a
// re-uploaded file re-arms the reminder, and nothing is sent twice for the same threshold.

import { crossedThresholds, stateFor } from '../thresholds'
import { addDays, daysBetween } from '../dates'
import type { ReminderItem } from '../types'

const CLOSING_BEFORE = [14, 7, 3]
const REVIEW_AFTER_DAYS = 3
const EXPIRY_BEFORE = [90, 30]
const MAX_NAMES = 6

export interface OnboardingClosingDue {
  id: string
  name: string
  vehicle: string
  closeDate: string
  /** Entities admitted at this closing whose checklist is not complete. */
  incomplete: string[]
  total: number
}

export interface OnboardingReviewDue {
  itemId: string
  entity: string
  kindLabel: string
  /** ISO date the LP uploaded it. */
  submittedOn: string
}

export interface OnboardingExpiry {
  itemId: string
  entity: string
  kindLabel: string
  expiresOn: string
}

export interface OnboardingData {
  closings: OnboardingClosingDue[]
  awaitingReview: OnboardingReviewDue[]
  expiring: OnboardingExpiry[]
}

const names = (list: string[]) => list.slice(0, MAX_NAMES).join(', ') + (list.length > MAX_NAMES ? ` +${list.length - MAX_NAMES} more` : '')

export function onboardingReminders(data: OnboardingData, today: string): ReminderItem[] {
  const out: ReminderItem[] = []

  for (const c of data.closings) {
    if (c.incomplete.length === 0 || daysBetween(today, c.closeDate) > CLOSING_BEFORE[0]) continue
    out.push({
      source: 'onboarding',
      keys: crossedThresholds(c.closeDate, today, CLOSING_BEFORE).map(t => `ob:close:${c.id}:${c.closeDate}:${t}`),
      title: `${c.name} — ${c.vehicle}: ${c.incomplete.length} of ${c.total} entit${c.total === 1 ? 'y' : 'ies'} not complete`,
      detail: `Still outstanding: ${names(c.incomplete)}`,
      dueDate: c.closeDate,
      state: stateFor(c.closeDate, today),
      href: '/lp-portal',
    })
  }

  for (const r of data.awaitingReview) {
    const due = addDays(r.submittedOn, REVIEW_AFTER_DAYS)
    if (daysBetween(today, due) > 0) continue
    out.push({
      source: 'onboarding',
      keys: crossedThresholds(due, today, []).map(t => `ob:review:${r.itemId}:${r.submittedOn}:${t}`),
      title: `${r.kindLabel} from ${r.entity} awaiting review`,
      detail: `Uploaded ${r.submittedOn}`,
      dueDate: due,
      state: stateFor(due, today),
      href: '/lp-portal',
    })
  }

  for (const e of data.expiring) {
    if (daysBetween(today, e.expiresOn) > EXPIRY_BEFORE[0]) continue
    out.push({
      source: 'onboarding',
      keys: crossedThresholds(e.expiresOn, today, EXPIRY_BEFORE).map(t => `ob:expire:${e.itemId}:${e.expiresOn}:${t}`),
      title: `${e.kindLabel} for ${e.entity} ${daysBetween(today, e.expiresOn) < 0 ? 'has expired' : 'expires'}`,
      detail: 'A current one is needed before the next K-1 or distribution',
      dueDate: e.expiresOn,
      state: stateFor(e.expiresOn, today),
      href: '/lp-portal',
    })
  }

  return out
}
