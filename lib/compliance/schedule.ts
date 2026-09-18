// When each compliance item falls due, for one fund and one year. Shared by the compliance page
// (calendar + list) and the ops-reminders cron, so "what's due when" has one definition.
//
// Items are expanded into INSTANCES keyed the way compliance_fund_settings keys them:
//   firm annual → group undefined; vehicle annual → "Fund II";
//   firm quarterly → "Q3"; vehicle quarterly → "Fund II::Q3"; event-driven → "Fund II".

import { addDays, monthEnd, ymd } from '@/lib/reminders/dates'

export interface ScheduleItem {
  id: string
  frequency: string
  scope: 'firm' | 'vehicle'
  deadline_month: number | null
  deadline_day: number | null
  rolling_days?: number | null
}

export interface Instance<T extends ScheduleItem = ScheduleItem> {
  item: T
  group?: string
  months: number[]
}

export interface Occurrence<T extends ScheduleItem = ScheduleItem> {
  item: T
  groupKey: string
  portfolioGroup: string
  quarter: number
  /** The year the instance was expanded for — the page's display year. For event-driven items
   *  that is the close's year, even when close + rolling_days lands in January. */
  year: number
  dueDate: string
}

/** Four [month, day] due dates per quarterly item, Q1..Q4. */
export const QUARTERLY_DUE: Record<string, [number, number][]> = {
  'valuations-soi': [[3, 31], [6, 30], [9, 30], [12, 31]],
  'partnership-expenses': [[3, 31], [6, 30], [9, 30], [12, 31]],
  // Q4 annual financials at 90 days; Q1-Q3 at 60.
  'quarterly-financial-reporting': [[3, 31], [5, 30], [8, 29], [11, 29]],
  // Rule 204A-1 transaction reports: 30 days after quarter end.
  'quarterly-disclosures': [[1, 30], [4, 30], [7, 30], [10, 30]],
  // 45 days after quarter end.
  'form-13f': [[2, 14], [5, 15], [8, 14], [11, 14]],
}

const DEFAULT_QUARTERLY_DUE: [number, number][] = [[1, 31], [4, 30], [7, 31], [10, 31]]

export function quarterlyDue(itemId: string): [number, number][] {
  return QUARTERLY_DUE[itemId] ?? DEFAULT_QUARTERLY_DUE
}

export function groupKey(portfolioGroup: string, quarter: number): string {
  if (!quarter) return portfolioGroup
  return portfolioGroup ? `${portfolioGroup}::Q${quarter}` : `Q${quarter}`
}

export function parseGroupKey(key: string): { portfolioGroup: string; quarter: number } {
  const m = key.match(/^(?:(.*)::)?Q([1-4])$/)
  if (!m) return { portfolioGroup: key, quarter: 0 }
  return { portfolioGroup: m[1] ?? '', quarter: Number(m[2]) }
}

export function expandInstances<T extends ScheduleItem>(
  items: T[],
  portfolioGroups: string[],
  closeMonths: Record<string, number[]>,
): Instance<T>[] {
  const out: Instance<T>[] = []
  const groupsWithCloses = Object.keys(closeMonths).filter(pg => closeMonths[pg].length > 0)

  for (const item of items) {
    if (item.frequency === 'Event-driven') {
      for (const pg of groupsWithCloses) out.push({ item, group: pg, months: closeMonths[pg] })
    } else if (item.frequency === 'Quarterly') {
      const groups = item.scope === 'vehicle' ? portfolioGroups : ['']
      for (const pg of groups) {
        quarterlyDue(item.id).forEach(([month], i) => {
          out.push({ item, group: groupKey(pg, i + 1), months: [month] })
        })
      }
    } else {
      const months = item.deadline_month ? [item.deadline_month] : []
      if (item.scope === 'vehicle') {
        for (const pg of portfolioGroups) out.push({ item, group: pg, months })
      } else {
        out.push({ item, group: undefined, months })
      }
    }
  }
  return out
}

export function occurrencesForYear<T extends ScheduleItem>(
  items: T[],
  opts: { year: number; portfolioGroups: string[]; closeDates: Record<string, string[]> },
): Occurrence<T>[] {
  const { year } = opts
  const closesThisYear: Record<string, string[]> = {}
  const closeMonths: Record<string, number[]> = {}
  for (const [pg, dates] of Object.entries(opts.closeDates)) {
    const inYear = dates.filter(d => d.startsWith(`${year}-`)).sort()
    closesThisYear[pg] = inYear
    closeMonths[pg] = [...new Set(inYear.map(d => Number(d.slice(5, 7))))]
  }

  const out: Occurrence<T>[] = []
  for (const inst of expandInstances(items, opts.portfolioGroups, closeMonths)) {
    const key = inst.group ?? ''
    const { portfolioGroup, quarter } = parseGroupKey(key)
    const due = dueDate(inst.item, year, portfolioGroup, quarter, closesThisYear)
    if (due) out.push({ item: inst.item, groupKey: key, portfolioGroup, quarter, year, dueDate: due })
  }
  return out
}

function dueDate(
  item: ScheduleItem,
  year: number,
  portfolioGroup: string,
  quarter: number,
  closesThisYear: Record<string, string[]>,
): string | null {
  if (item.frequency === 'Event-driven') {
    const first = closesThisYear[portfolioGroup]?.[0]
    return first && item.rolling_days ? addDays(first, item.rolling_days) : null
  }
  if (item.frequency === 'Quarterly') {
    const [month, day] = quarterlyDue(item.id)[quarter - 1]
    return ymd(year, month, day)
  }
  if (!item.deadline_month) return null
  return ymd(year, item.deadline_month, item.deadline_day ?? monthEnd(year, item.deadline_month))
}
