// Carry PAID per recipient — the carry equivalent of the CapitalPosting[] seam. A vehicle keeps
// exactly one producer: the ledger (carry_distribution postings on the associate's own books) or
// the tracking register (carry_payments). One resolver so callers stop branching on the mode.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CapitalPosting } from './capital-account'
import type { CapitalSource } from './capital-source'
import { roundCents } from './ledger'

export interface CarryPayment {
  id: string
  lpEntityId: string
  date: string
  amount: number
  memo: string | null
}

export async function resolveCarryPaid(
  admin: SupabaseClient,
  opts: { source: CapitalSource; ownPostings: CapitalPosting[]; fundId: string; vehicleId: string },
): Promise<{ paidByLp: Map<string, number>; payments: CarryPayment[] }> {
  const paidByLp = new Map<string, number>()
  const payments: CarryPayment[] = []

  if (opts.source === 'ledger') {
    // Carry paid = carried-interest DISTRIBUTIONS on the associate's own books, tagged
    // source_type 'carry_distribution' — distinct from return-of-capital distributions AND from
    // the accrual marks ('carried_interest'). A payment debits the member's capital (positive
    // posting amount); its magnitude is the carry paid. No separate register to maintain.
    for (const p of opts.ownPostings) {
      if (!p.lpEntityId || p.sourceType !== 'carry_distribution') continue
      paidByLp.set(p.lpEntityId, roundCents((paidByLp.get(p.lpEntityId) ?? 0) + p.amount))
    }
  } else {
    // Tracking: an explicit (partner, date, amount) register, edited on the GP panel — the
    // tracking equivalent of the ledger's distribution postings.
    const { data: rows } = await (admin as any)
      .from('carry_payments')
      .select('id, lp_entity_id, paid_date, amount, memo')
      .eq('fund_id', opts.fundId).eq('vehicle_id', opts.vehicleId)
      .order('paid_date', { ascending: false })
    for (const r of ((rows as any[]) ?? [])) {
      paidByLp.set(r.lp_entity_id, (paidByLp.get(r.lp_entity_id) ?? 0) + Number(r.amount))
      payments.push({ id: r.id as string, lpEntityId: r.lp_entity_id as string, date: r.paid_date as string, amount: Number(r.amount), memo: (r.memo ?? null) as string | null })
    }
  }

  return { paidByLp, payments }
}
