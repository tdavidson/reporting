// Payments by vendor — the 1099 worksheet. Pure.
//
// Cash basis, as the form is: a payment is a CREDIT to a cash account on a posted entry that
// names a vendor, in the year. An accrual (Dr expense / Cr accounts payable) is not a payment;
// its later settlement (Dr payable / Cr cash) is, and carries the vendor if it was booked with
// one. Refunds — a debit to cash on a vendor entry — net against the year's payments.

import { roundCents } from './ledger'

export interface VendorPaymentEntry {
  id: string
  entryDate: string
  memo: string | null
  reference?: string | null
  vendorId: string | null
  postings: { accountId: string; amount: number }[]
}

export interface VendorInfo {
  id: string
  name: string
  is1099Eligible: boolean
  tinOnFile: boolean
}

export interface VendorPaymentRow {
  vendorId: string
  name: string
  is1099Eligible: boolean
  tinOnFile: boolean
  /** Net cash paid to the vendor in the window. */
  paid: number
  entries: number
  /** Eligible, paid at or above the threshold, and no TIN on file — the row to chase. */
  needsW9: boolean
  /** Eligible and at or above the reporting threshold. */
  reportable: boolean
}

/** The federal reporting threshold for non-employee compensation and most miscellaneous payments. */
export const FORM_1099_THRESHOLD = 600

export function vendorPayments(
  entries: VendorPaymentEntry[],
  vendors: VendorInfo[],
  cashAccountIds: Set<string>,
  period: { start?: string | null; end?: string | null } = {},
): { rows: VendorPaymentRow[]; totalPaid: number } {
  const byId = new Map(vendors.map(v => [v.id, v]))
  const paid = new Map<string, { paid: number; entries: number }>()
  for (const e of entries) {
    if (!e.vendorId) continue
    if (period.start && e.entryDate < period.start) continue
    if (period.end && e.entryDate > period.end) continue
    // Cash out is a credit (negative signed); a refund is a debit and nets.
    const cashOut = roundCents(-e.postings.filter(p => cashAccountIds.has(p.accountId)).reduce((s, p) => s + p.amount, 0))
    if (cashOut === 0) continue
    const cur = paid.get(e.vendorId) ?? { paid: 0, entries: 0 }
    cur.paid = roundCents(cur.paid + cashOut)
    cur.entries += 1
    paid.set(e.vendorId, cur)
  }
  const rows: VendorPaymentRow[] = Array.from(paid.entries()).map(([vendorId, p]) => {
    const v = byId.get(vendorId)
    const eligible = v?.is1099Eligible ?? false
    const reportable = eligible && p.paid >= FORM_1099_THRESHOLD
    return {
      vendorId,
      name: v?.name ?? vendorId,
      is1099Eligible: eligible,
      tinOnFile: v?.tinOnFile ?? false,
      paid: p.paid,
      entries: p.entries,
      reportable,
      needsW9: reportable && !(v?.tinOnFile ?? false),
    }
  }).sort((a, b) => b.paid - a.paid || a.name.localeCompare(b.name))
  return { rows, totalPaid: roundCents(rows.reduce((s, r) => s + r.paid, 0)) }
}

export const VENDOR_PAYMENTS_HEADER = ['Vendor', 'Paid', 'Entries', '1099 eligible', 'TIN on file', 'Reportable', 'Needs W-9']

export function vendorPaymentsRows(r: { rows: VendorPaymentRow[]; totalPaid: number }): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [VENDOR_PAYMENTS_HEADER]
  for (const v of r.rows) rows.push([v.name, v.paid, v.entries, v.is1099Eligible ? 'yes' : 'no', v.tinOnFile ? 'yes' : 'no', v.reportable ? 'yes' : '', v.needsW9 ? 'yes' : ''])
  rows.push(['Total', r.totalPaid, null, '', '', '', ''])
  return rows
}
