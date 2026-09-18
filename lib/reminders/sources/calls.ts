// Capital calls still unfunded as their due date approaches and passes: three days before, on the
// day, then weekly. One item per call, however many partners are behind — the card on the
// capital-accounts page says who. Keys embed the due date, so moving it re-arms the reminder; they
// do not embed the outstanding amount, so a partner paying does not send a fresh email (the next
// threshold does), and the item disappears on its own once the last wire lands.

import { crossedThresholds, stateFor } from '../thresholds'
import { daysBetween } from '../dates'
import type { ReminderItem } from '../types'

const BEFORE = [3]
const MAX_NAMES = 6

export interface OpenCall {
  id: string
  vehicleId: string | null
  vehicle: string
  callDate: string
  dueDate: string
  callNumber: number | null
  description: string | null
  /** Still to arrive, across every partner. */
  outstanding: number
  /** The partners who still owe something on this call. */
  unfunded: string[]
  currency: string
}

export interface CallsData {
  openCalls: OpenCall[]
}

export function callsDueReminders(data: CallsData, today: string): ReminderItem[] {
  return data.openCalls
    .filter(c => c.outstanding > 0.005 && daysBetween(today, c.dueDate) <= BEFORE[0])
    .map(c => {
      const label = `Capital call${c.callNumber ? ` No. ${c.callNumber}` : ` of ${c.callDate}`} — ${c.vehicle}`
      const names = c.unfunded.slice(0, MAX_NAMES).join(', ') + (c.unfunded.length > MAX_NAMES ? ` +${c.unfunded.length - MAX_NAMES} more` : '')
      const amount = `${c.currency} ${c.outstanding.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      return {
        source: 'calls_due' as const,
        keys: crossedThresholds(c.dueDate, today, BEFORE).map(t => `cc:${c.id}:${c.dueDate}:${t}`),
        title: `${label}: ${amount} unfunded`,
        detail: `${c.unfunded.length} partner${c.unfunded.length === 1 ? '' : 's'} outstanding: ${names}`,
        dueDate: c.dueDate,
        state: stateFor(c.dueDate, today),
        href: c.vehicleId ? `/funds/${c.vehicleId}/capital-accounts` : '/funds/capital-accounts',
      }
    })
}
