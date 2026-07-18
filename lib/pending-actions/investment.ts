import type { ActionDeps, PreviewResult } from './types'
import { resolveCompany, executeRecordInvestment, type RecordInvestmentInput } from '@/lib/agent/portfolio-tools'

export { executeRecordInvestment }
export type { RecordInvestmentInput }

/**
 * Read-only preview of a `record_investment`: resolve the company and describe the transaction and
 * its ledger effect WITHOUT writing anything (no insert, no `draftEntryForTransaction`). The real
 * write happens only when a human approves, via `executeRecordInvestment`.
 */
export async function previewRecordInvestment(deps: ActionDeps, input: RecordInvestmentInput): Promise<PreviewResult> {
  const c = await resolveCompany(deps.admin, deps.fundId, input.company)
  const amount =
    input.investment_cost ?? input.proceeds_received ?? input.unrealized_value_change ?? null
  const convertsFrom = input.converts_from_txn_id ?? null

  return {
    summary:
      `Record ${input.transaction_type} for ${c.name}` +
      (amount != null ? ` (${amount})` : '') +
      (convertsFrom ? ' — conversion' : ''),
    details: {
      company: c.name,
      transaction_type: input.transaction_type,
      amount,
      vehicle: input.vehicle ?? null,
      ...(convertsFrom ? { convertsFrom } : {}),
      ledgerEffect: `Drafts a journal entry in ${input.vehicle ?? 'the vehicle'} for review — it does not post.`,
    },
  }
}
