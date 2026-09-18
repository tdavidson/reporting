// Compliance filings that are due within 30 days or overdue, for items the fund has marked (or
// the questionnaire evaluated) as applying. Looks at last year, this year and next so a Q4 item
// stays visible into January and a January deadline shows up in December.

import { evaluateAll, type ComplianceProfile } from '@/lib/compliance/applicability'
import { groupKey, occurrencesForYear, type Occurrence, type ScheduleItem } from '@/lib/compliance/schedule'
import { resolveStatus } from '@/lib/compliance/status'
import { daysBetween } from '../dates'
import { crossedThresholds, stateFor } from '../thresholds'
import type { ReminderItem } from '../types'

export interface ComplianceItemRow extends ScheduleItem {
  name: string
  short_name: string
}

export interface ComplianceData {
  items: ComplianceItemRow[]
  profile: ComplianceProfile | null
  settings: { compliance_item_id: string; portfolio_group: string | null; applies: string | null; dismissed: boolean | null }[]
  closed: { compliance_item_id: string; portfolio_group: string; quarter: number; year: number }[]
  portfolioGroups: string[]
  closeDates: Record<string, string[]>
}

const BEFORE = [30, 14, 3]
/** An occurrence overdue longer than this stops reminding. Without a cap, last year's unfiled
 *  annual item would sit next to this year's, and enabling reminders mid-year would open with a
 *  flood of long-past deadlines nobody marked complete. */
const MAX_OVERDUE_DAYS = 90

export function complianceReminders(data: ComplianceData, today: string): ReminderItem[] {
  const applicability = data.profile ? evaluateAll(data.profile) : {}
  const settingByKey = new Map(data.settings.map(s => [`${s.compliance_item_id}|${s.portfolio_group ?? ''}`, s]))
  const closed = new Set(data.closed.map(c => `${c.compliance_item_id}|${groupKey(c.portfolio_group ?? '', c.quarter ?? 0)}|${c.year}`))
  const thisYear = Number(today.slice(0, 4))

  const out: ReminderItem[] = []
  for (const year of [thisYear - 1, thisYear, thisYear + 1]) {
    const occurrences = occurrencesForYear(data.items, { year, portfolioGroups: data.portfolioGroups, closeDates: data.closeDates })
    for (const occ of occurrences) {
      const status = resolveStatus(settingByKey.get(`${occ.item.id}|${occ.groupKey}`), applicability[occ.item.id]?.result)
      if (status !== 'applies') continue
      if (closed.has(`${occ.item.id}|${occ.groupKey}|${occ.year}`)) continue
      const until = daysBetween(today, occ.dueDate)
      if (until > BEFORE[0] || -until > MAX_OVERDUE_DAYS) continue
      out.push({
        source: 'compliance',
        keys: crossedThresholds(occ.dueDate, today, BEFORE).map(t => `c:${occ.item.id}:${occ.groupKey}:${occ.dueDate}:${t}`),
        title: occ.item.name,
        detail: detailFor(occ),
        dueDate: occ.dueDate,
        state: stateFor(occ.dueDate, today),
        href: `/compliance?year=${occ.year}`,
      })
    }
  }
  return out
}

function detailFor(occ: Occurrence<ComplianceItemRow>): string | undefined {
  const parts = [occ.portfolioGroup, occ.quarter ? `Q${occ.quarter}` : ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}
