// "Time to send this quarter's portfolio data request": from quarter end + the fund's offset
// (at least a day), weekly, until a request for that quarter has been sent. When the next
// quarter ends the reporting quarter moves on and the old nudge disappears on its own.

import { lastEndedQuarter } from '@/lib/requests/response-status'
import { addDays, daysBetween } from '../dates'
import { crossedThresholds, stateFor } from '../thresholds'
import type { ReminderItem } from '../types'

export interface AsksData {
  sendOffsetDays: number
  requests: { quarter: number | null; year: number | null; due_date: string | null; status: string }[]
  companies: { id: string; name: string }[]
  hasData: Set<string>
  overrides: Map<string, string>
}

export function asksSendReminders(data: AsksData, today: string): ReminderItem[] {
  if (data.companies.length === 0) return []
  const rq = lastEndedQuarter(today)
  // At least one day after quarter end: the default offset 0 would otherwise make the nudge due
  // ON the quarter's last day, opening as "1 day overdue" the morning after.
  const nudge = addDays(rq.endDate, Math.max(1, data.sendOffsetDays))
  if (daysBetween(nudge, today) < 0) return []
  const sent = data.requests.some(r => r.status === 'sent' && r.quarter === rq.quarter && r.year === rq.year)
  if (sent) return []

  const n = data.companies.length
  return [{
    source: 'asks_send',
    keys: crossedThresholds(nudge, today, []).map(t => `as:${rq.year}Q${rq.quarter}:${nudge}:${t}`),
    title: `Send the Q${rq.quarter} ${rq.year} portfolio data request`,
    detail: `${n} active ${n === 1 ? 'company' : 'companies'}`,
    dueDate: nudge,
    state: stateFor(nudge, today),
    href: '/requests',
  }]
}
