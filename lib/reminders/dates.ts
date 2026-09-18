// UTC calendar-date arithmetic on ISO `YYYY-MM-DD` strings. Reminders are evaluated in UTC,
// like the rest of the app; working on strings keeps a local timezone from shifting a due date.

const DAY_MS = 86_400_000

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parse(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`)
}

export function addDays(iso: string, n: number): string {
  return isoDate(new Date(parse(iso) + n * DAY_MS))
}

/** `to − from` in whole days. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to) - parse(from)) / DAY_MS)
}

/** Last day number of `month` (1-12). */
export function monthEnd(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** ISO date for year/month/day, clamping `day` to the month (Feb 31 → Feb 28). */
export function ymd(year: number, month: number, day: number): string {
  const d = Math.min(day, monthEnd(year, month))
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
