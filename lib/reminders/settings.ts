import { parseAddressList } from '@/lib/email'

const MAX_RECIPIENTS = 20

/** The reminder recipient list from free text. Empty is valid: it means "the fund's admins". */
export function parseRecipients(input: string | null | undefined): { value: string[] } | { invalid: string } {
  const parsed = parseAddressList(input)
  if (parsed.invalid) return { invalid: parsed.invalid }
  const value = parsed.value ? parsed.value.split(', ') : []
  if (value.length > MAX_RECIPIENTS) return { invalid: `more than ${MAX_RECIPIENTS} recipients` }
  return { value }
}
