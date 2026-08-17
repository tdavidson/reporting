import type { QbAccountSummary } from './parse-journal'

/**
 * Propose a mapping from QuickBooks' chart to ours. Pure and deterministic.
 *
 * Every proposal is confirmed by a human before anything imports, so this optimizes for
 * being USEFUL AND HONEST rather than always right: a confident wrong mapping silently
 * misstates a whole account for years of history, while `confidence: 'none'` costs one
 * dropdown. When in doubt, return none.
 *
 * The one genuinely clever step is holding discovery. A fund of funds keeps a QuickBooks
 * sub-account per underlying fund ("Investments:Acme Ventures III"), so the mapping screen
 * is also where the twenty-odd fund holdings get created — the leaf of an investment
 * account path is the fund's name.
 */

export interface ChartAccount {
  id: string
  code: string
  name: string
  type: string
  subtype: string | null
}

export interface MappingProposal {
  qbAccount: string
  code: string | null
  confidence: 'exact' | 'likely' | 'none'
  reason: string
  /** Non-null when this QB account implies a fund holding we should create. */
  suggestsHolding: string | null
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const leaf = (path: string) => path.split(':').pop()!.trim()
const head = (path: string) => path.split(':')[0]!.trim()

// Keyword → account subtype. Ordered: the first hit wins, so put the specific before the general.
const KEYWORDS: { match: RegExp; subtype: string; why: string }[] = [
  { match: /\b(bank|checking|operating|cash|money market)\b/i, subtype: 'cash', why: 'looks like a bank or cash account' },
  { match: /\binvestment|portfolio|holdings?\b/i, subtype: 'investment', why: 'looks like an investment account' },
  { match: /\bmanagement fee\b/i, subtype: 'management_fee', why: 'names the management fee' },
  { match: /\b(audit|legal|accounting|professional|admin|partnership)\s+(fee|expense)s?\b/i, subtype: 'partnership_expense', why: 'looks like a partnership expense' },
  { match: /\borgani[sz]ation(al)?\s+(cost|expense)s?\b/i, subtype: 'organizational_expense', why: 'looks like an organizational expense' },
  { match: /\binterest\s+(income|earned)\b/i, subtype: 'interest_income', why: 'looks like interest income' },
  { match: /\brealized\s+(gain|loss)\b/i, subtype: 'realized_gain', why: 'looks like realized gain/loss' },
  { match: /\bunrealized\b/i, subtype: 'unrealized', why: 'looks like an unrealized valuation account' },
  { match: /\b(accrued|accounts payable|a\/p)\b/i, subtype: 'accrued', why: 'looks like an accrual or payable' },
  { match: /\b(partners?'? capital|members?'? capital|equity)\b/i, subtype: 'lp_capital', why: "looks like partners' capital" },
]

export function proposeMapping(
  qbAccounts: QbAccountSummary[],
  chart: ChartAccount[],
): MappingProposal[] {
  const byName = new Map(chart.map(a => [norm(a.name), a]))
  const bySubtype = new Map<string, ChartAccount>()
  for (const a of chart) if (a.subtype && !bySubtype.has(a.subtype)) bySubtype.set(a.subtype, a)

  return qbAccounts.map(({ account }) => {
    const holding = holdingFor(account)

    // 1. Our account name, verbatim.
    const exact = byName.get(norm(leaf(account))) ?? byName.get(norm(account))
    if (exact) {
      return { qbAccount: account, code: exact.code, confidence: 'exact' as const,
               reason: `Matches "${exact.name}" by name.`, suggestsHolding: holding }
    }

    // 2. Keyword → subtype → the first account of that subtype in our chart.
    for (const k of KEYWORDS) {
      if (!k.match.test(account)) continue
      const target = bySubtype.get(k.subtype)
      if (!target) continue
      return { qbAccount: account, code: target.code, confidence: 'likely' as const,
               reason: `${cap(k.why)}; mapped to ${target.code} ${target.name}.`, suggestsHolding: holding }
    }

    return {
      qbAccount: account, code: null, confidence: 'none' as const,
      reason: 'No confident match in the chart of accounts — choose one, or add an account for it.',
      suggestsHolding: holding,
    }
  })
}

/**
 * The fund holding a QuickBooks account implies, if any. Only a SUB-account under an
 * investments parent counts: "Investments:Acme Ventures III" is a holding, bare "Investments"
 * is the parent, and a top-level "Acme Ventures III" is too ambiguous to act on — guessing
 * there would create a phantom holding carrying a real commitment field.
 */
function holdingFor(account: string): string | null {
  if (!account.includes(':')) return null
  if (!/^invest(ment)?s?\b|^portfolio\b|^holdings?\b/i.test(head(account))) return null
  const name = leaf(account)
  return name && !/^invest(ment)?s?$/i.test(name) ? name : null
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
