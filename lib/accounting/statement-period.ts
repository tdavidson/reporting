// Statement periods for the capital-account roll-forward.
//
// Deliberately NOT tied to `fiscal_periods`: those rows only exist for periods
// someone explicitly CLOSED, so relying on them would mean "this quarter" doesn't
// exist as an option until after you've locked it. These are pure date math and
// always available; a closed fiscal period can be offered alongside them.

export type PeriodPreset = 'this_quarter' | 'last_quarter' | 'ytd' | 'prior_year' | 'itd' | 'custom'

export interface StatementPeriod {
  preset: PeriodPreset
  /** Inclusive; null means "since inception". */
  start: string | null
  /** Inclusive. */
  end: string | null
  label: string
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const q = (month: number) => Math.floor(month / 3) // 0-3

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'last_quarter', label: 'Last quarter' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'prior_year', label: 'Prior year' },
  { value: 'itd', label: 'Inception to date' },
  { value: 'custom', label: 'Custom…' },
]

/** Resolve a preset to a concrete date window, relative to `today`. */
export function resolvePeriod(preset: PeriodPreset, today: Date = new Date()): StatementPeriod {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()

  switch (preset) {
    case 'this_quarter': {
      const qi = q(m)
      const start = new Date(Date.UTC(y, qi * 3, 1))
      const end = new Date(Date.UTC(y, qi * 3 + 3, 0)) // day 0 of next month = last day of this
      return { preset, start: iso(start), end: iso(end), label: `Q${qi + 1} ${y}` }
    }
    case 'last_quarter': {
      const qi = q(m) - 1
      const ly = qi < 0 ? y - 1 : y
      const lq = qi < 0 ? 3 : qi
      const start = new Date(Date.UTC(ly, lq * 3, 1))
      const end = new Date(Date.UTC(ly, lq * 3 + 3, 0))
      return { preset, start: iso(start), end: iso(end), label: `Q${lq + 1} ${ly}` }
    }
    case 'ytd':
      return { preset, start: iso(new Date(Date.UTC(y, 0, 1))), end: iso(today), label: `YTD ${y}` }
    case 'prior_year':
      return {
        preset,
        start: iso(new Date(Date.UTC(y - 1, 0, 1))),
        end: iso(new Date(Date.UTC(y - 1, 11, 31))),
        label: `FY ${y - 1}`,
      }
    case 'itd':
    default:
      return { preset: 'itd', start: null, end: null, label: 'Inception to date' }
  }
}

/** A custom window, for the explicit start/end date inputs. */
export function customPeriod(start: string | null, end: string | null): StatementPeriod {
  return {
    preset: 'custom',
    start: start || null,
    end: end || null,
    label: start && end ? `${start} → ${end}` : end ? `Through ${end}` : start ? `From ${start}` : 'Inception to date',
  }
}

// --- Comparison stepping -----------------------------------------------------

type PeriodInterval = 'quarter' | 'year' | 'ytd' | 'custom-length' | 'none'

function intervalOf(preset: PeriodPreset): PeriodInterval {
  switch (preset) {
    case 'this_quarter':
    case 'last_quarter': return 'quarter'
    case 'prior_year': return 'year'
    case 'ytd': return 'ytd'
    case 'custom': return 'custom-length'
    default: return 'none' // itd
  }
}

const addMonthsUTC = (isoDate: string, months: number): string => {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}
const addDaysUTC = (isoDate: string, days: number): string => {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const addYearsClampUTC = (isoDate: string, years: number): string => {
  const d = new Date(isoDate + 'T00:00:00Z')
  const year = d.getUTCFullYear() + years
  const month = d.getUTCMonth()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate() // last day of that month/year
  const day = Math.min(d.getUTCDate(), lastDay)                       // clamp Feb 29 → Feb 28 in non-leap years
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)
}
const daysInclusive = (start: string, end: string): number => {
  const a = new Date(start + 'T00:00:00Z').getTime()
  const b = new Date(end + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86_400_000) + 1
}
const yearOf = (isoDate: string) => Number(isoDate.slice(0, 4))
const quarterLabel = (start: string) => {
  const month = Number(start.slice(5, 7)) - 1
  return `Q${Math.floor(month / 3) + 1} ${yearOf(start)}`
}

/** The window `k` intervals before `base` (k≥1), or null if base can't be stepped. */
function priorPeriod(base: StatementPeriod, k: number): StatementPeriod | null {
  const kind = intervalOf(base.preset)
  if (!base.start || !base.end) return null
  if (kind === 'quarter') {
    const start = addMonthsUTC(base.start, -3 * k)
    const end = addDaysUTC(addMonthsUTC(start, 3), -1)
    return { preset: base.preset, start, end, label: quarterLabel(start) }
  }
  if (kind === 'year') {
    const start = addMonthsUTC(base.start, -12 * k)
    const end = addDaysUTC(addMonthsUTC(start, 12), -1)
    return { preset: base.preset, start, end, label: `FY ${yearOf(start)}` }
  }
  if (kind === 'ytd') {
    const start = addMonthsUTC(base.start, -12 * k) // base.start is Jan 1 → never overflows
    const end = addYearsClampUTC(base.end, -k)
    return { preset: base.preset, start, end, label: `YTD ${yearOf(start)}` }
  }
  if (kind === 'custom-length') {
    const len = daysInclusive(base.start, base.end)
    const start = addDaysUTC(base.start, -len * k)
    const end = addDaysUTC(base.end, -len * k)
    return { preset: 'custom', start, end, label: `${start} → ${end}` }
  }
  return null // 'none' (itd)
}

/**
 * Up to `count` prior windows of the same shape as `base`, most-recent-first.
 * Stops once a window ends before `earliest` (the fund's first posting) — that
 * data bound is what "as many periods as exist" means. `count` may be Infinity.
 */
export function comparisonPeriods(
  base: StatementPeriod,
  count: number,
  earliest: string | null,
): StatementPeriod[] {
  if (count <= 0 || !earliest || intervalOf(base.preset) === 'none') return []
  const out: StatementPeriod[] = []
  for (let k = 1; k <= count && out.length < 200; k++) {
    const p = priorPeriod(base, k)
    if (!p || !p.end || p.end < earliest) break
    out.push(p)
  }
  return out
}
