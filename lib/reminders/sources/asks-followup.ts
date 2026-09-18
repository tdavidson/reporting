// Follow-ups on the current quarter's data request: from 7 days before its responses-due date,
// weekly once overdue, while any active company is still outstanding (not reported, not N/A,
// not "Stopped"). Keys don't depend on who is outstanding, so a company responding doesn't
// trigger a fresh email — the next threshold does.

import { isOutstanding, lastEndedQuarter, resolveResponseStatus, responseKey } from '@/lib/requests/response-status'
import { daysBetween } from '../dates'
import { crossedThresholds, stateFor } from '../thresholds'
import type { ReminderItem } from '../types'
import type { AsksData } from './asks-send'

const BEFORE = [7, 3]
const MAX_NAMES = 10

export function asksFollowupReminders(data: AsksData, today: string): ReminderItem[] {
  const rq = lastEndedQuarter(today)
  const dues = data.requests
    .filter(r => r.status === 'sent' && r.quarter === rq.quarter && r.year === rq.year && r.due_date)
    .map(r => r.due_date as string)
    .sort()
  const due = dues[dues.length - 1]
  if (!due || daysBetween(today, due) > BEFORE[0]) return []

  const outstanding = data.companies.filter(c => {
    const key = responseKey(c.id, rq.year, rq.quarter)
    return isOutstanding(resolveResponseStatus(data.hasData.has(key), data.overrides.get(key)))
  })
  if (outstanding.length === 0) return []

  const n = outstanding.length
  const names = outstanding.slice(0, MAX_NAMES).map(c => c.name)
  if (n > MAX_NAMES) names.push(`+${n - MAX_NAMES} more`)

  return [{
    source: 'asks_followup',
    keys: crossedThresholds(due, today, BEFORE).map(t => `af:${rq.year}Q${rq.quarter}:${due}:${t}`),
    title: `Q${rq.quarter} ${rq.year} data request: ${n} ${n === 1 ? "company hasn't" : "companies haven't"} responded`,
    detail: names.join(', '),
    dueDate: due,
    state: stateFor(due, today),
    href: '/requests',
  }]
}
