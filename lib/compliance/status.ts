import type { Applicability } from './applicability'

export interface StatusSetting {
  completed?: boolean | null
  dismissed?: boolean | null
  applies?: string | null
}

/** An item's effective status: the fund's explicit setting first, then the questionnaire's
 *  evaluation. Shared by the compliance page and the ops-reminders compliance source. */
export function resolveStatus(setting: StatusSetting | undefined, fallback: Applicability | undefined): Applicability {
  if (setting?.completed) return 'completed'
  if (setting?.dismissed) return 'not_applicable'
  if (setting?.applies === 'yes') return 'applies'
  if (setting?.applies === 'no') return 'not_applicable'
  return fallback ?? 'needs_review'
}
