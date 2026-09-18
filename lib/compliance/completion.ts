// Compliance completion is stored per occurrence in compliance_deadlines (item × vehicle × year ×
// quarter). The page still reads completion off its settings rows, keyed "Fund II::Q3"; this
// overlays one year's occurrences onto those rows so the page's shape doesn't change — and
// overrides the stale, year-less compliance_fund_settings.completed flag it used to read.

import { groupKey } from './schedule'

export interface DeadlineRow {
  compliance_item_id: string
  portfolio_group: string
  quarter: number
  year: number
  status: string
  notes: string | null
  filing_reference_url: string | null
  created_at: string
}

export interface CompletionFields {
  completed: boolean
  completed_at: string | null
  completed_note: string | null
  completed_link: string | null
}

type SettingLike = { compliance_item_id: string; portfolio_group: string | null }

export function overlayCompletion<S extends SettingLike>(settings: S[], deadlines: DeadlineRow[]): (S & CompletionFields)[] {
  const filedByKey = new Map<string, DeadlineRow>()
  for (const d of deadlines) {
    if (d.status !== 'filed') continue
    filedByKey.set(`${d.compliance_item_id}|${groupKey(d.portfolio_group ?? '', d.quarter ?? 0)}`, d)
  }

  const fields = (d: DeadlineRow | undefined): CompletionFields => ({
    completed: !!d,
    completed_at: d?.created_at ?? null,
    completed_note: d?.notes ?? null,
    completed_link: d?.filing_reference_url ?? null,
  })

  const seen = new Set<string>()
  const out = settings.map(s => {
    const key = `${s.compliance_item_id}|${s.portfolio_group ?? ''}`
    seen.add(key)
    return { ...s, ...fields(filedByKey.get(key)) }
  })

  for (const [key, d] of filedByKey) {
    if (seen.has(key)) continue
    out.push({
      compliance_item_id: d.compliance_item_id,
      portfolio_group: groupKey(d.portfolio_group ?? '', d.quarter ?? 0),
      applies: null,
      dismissed: false,
      dismissed_reason: null,
      notes: null,
      ...fields(d),
    } as unknown as S & CompletionFields)
  }
  return out
}
