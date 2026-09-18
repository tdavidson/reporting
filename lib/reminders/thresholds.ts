import { daysBetween } from './dates'
import type { ReminderState } from './types'

/**
 * Every threshold already crossed for `dueDate` as of `today`: `t<N>` for each lead time N in
 * `before` (days before due), `t0` on/after the due day, then `od<W>` for each full week overdue.
 * All crossed keys are returned, not just the latest, so a missed cron day still re-sends.
 */
export function crossedThresholds(dueDate: string, today: string, before: number[]): string[] {
  const until = daysBetween(today, dueDate)
  const out: string[] = []
  for (const b of [...before].sort((x, y) => y - x)) if (until <= b) out.push(`t${b}`)
  if (until <= 0) out.push('t0')
  for (let w = 1; w <= Math.floor(-until / 7); w++) out.push(`od${w}`)
  return out
}

export function stateFor(dueDate: string, today: string): ReminderState {
  const until = daysBetween(today, dueDate)
  if (until < 0) return 'overdue'
  if (until <= 7) return 'due_soon'
  return 'upcoming'
}
