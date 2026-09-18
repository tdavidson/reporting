// Whether a portfolio company has answered the data request for a quarter. One definition for
// the response tracker (app/api/requests/responses) and the ops-reminders follow-up source.

import { monthEnd, ymd } from '@/lib/reminders/dates'

export type ResponseStatus = 'yes' | 'no' | 'na' | 'waived'
export const RESPONSE_STATUSES: ResponseStatus[] = ['yes', 'no', 'na', 'waived']

export function responseKey(companyId: string, year: number, quarter: number): string {
  return `${companyId}:${year}:${quarter}`
}

export function metricQuarter(mv: { period_quarter: number | null; period_month: number | null }): number | null {
  if (mv.period_quarter != null) return mv.period_quarter
  if (mv.period_month != null) return Math.ceil(mv.period_month / 3)
  return null
}

/**
 * A manual override wins over auto-detection — except `waived` ("stop chasing"), which yields to
 * real data: a company that eventually reports has responded, whatever we'd given up on.
 */
export function resolveResponseStatus(hasData: boolean, override: string | undefined): ResponseStatus {
  if (hasData && override === 'waived') return 'yes'
  if (override && (RESPONSE_STATUSES as string[]).includes(override)) return override as ResponseStatus
  return hasData ? 'yes' : 'no'
}

/** Still owed a response: not reported, not N/A, not given up on. */
export function isOutstanding(status: ResponseStatus): boolean {
  return status === 'no'
}

/** The most recently completed calendar quarter as of `today` — the one a request asks about. */
export function lastEndedQuarter(today: string): { year: number; quarter: number; endDate: string } {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const current = Math.floor((m - 1) / 3) + 1
  const quarter = current === 1 ? 4 : current - 1
  const year = current === 1 ? y - 1 : y
  return { year, quarter, endDate: ymd(year, quarter * 3, monthEnd(year, quarter * 3)) }
}
