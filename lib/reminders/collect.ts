import { complianceReminders, type ComplianceData } from './sources/compliance'
import { asksSendReminders, type AsksData } from './sources/asks-send'
import { asksFollowupReminders } from './sources/asks-followup'
import type { ReminderItem } from './types'

export interface FundReminderData {
  compliance: ComplianceData
  asks: AsksData
}

/** Every open reminder for one fund as of `today`, earliest due first. Pure. */
export function collectReminders(data: FundReminderData, today: string): ReminderItem[] {
  return [
    ...complianceReminders(data.compliance, today),
    ...asksSendReminders(data.asks, today),
    ...asksFollowupReminders(data.asks, today),
  ].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}
