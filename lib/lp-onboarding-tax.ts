// Recording a tax form at the moment it is verified.
//
// The Tax page used to be the only place a W-9 or W-8 got on file, which meant the facts read
// off an uploaded form were shown once and then retyped later — or not. Verification is where
// the person has the form open, so that is where the record is made. The Tax page stays the
// system of record: it reads what is written here, and it is where a form is amended.
//
// Access: tax-form records belong to the tax-reporting domain; the onboarding routes to LP
// relations. A route straddling two domains gates the extra part in the handler (CLAUDE.md), so
// the write happens only when the caller holds tax-reporting write — otherwise the verification
// stands and the facts are reported back as not recorded.

import type { SupabaseClient } from '@supabase/supabase-js'
import { hasAccess, loadAccessContext, type AccessContext } from '@/lib/access/effective'
import { defaultExpiry, isTaxFormType, type TaxFormType } from '@/lib/tax/forms'

export const TAX_CLASSIFICATIONS = [
  'individual', 'c_corp', 's_corp', 'partnership', 'trust_estate', 'llc',
  'disregarded_entity', 'exempt_organization', 'government', 'other',
] as const
export const TIN_TYPES = ['ssn', 'ein', 'itin', 'foreign', 'none'] as const

export interface TaxFormInput {
  formType: TaxFormType
  legalName: string | null
  tinType: (typeof TIN_TYPES)[number] | null
  tinLast4: string | null
  taxClassification: (typeof TAX_CLASSIFICATIONS)[number] | null
  country: string | null
  treatyClaimed: boolean
  signedDate: string | null
  expiresOn: string | null
}

const isoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * Validate what a reviewer confirmed. Returns an error string for anything that must not be
 * stored — above all a TIN longer than four digits, which is refused rather than truncated: a
 * caller sending a full number is doing something this table exists to prevent.
 */
export function parseTaxFormInput(raw: unknown): { input: TaxFormInput } | { error: string } | null {
  if (raw == null || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  if (!isTaxFormType(b.formType)) return { error: 'Pick which tax form it is (W-9, W-8BEN, W-8BEN-E, W-8IMY or W-8ECI).' }
  const digits = typeof b.tinLast4 === 'string' ? b.tinLast4.replace(/\D/g, '') : ''
  if (digits.length > 4) return { error: 'Only the last four digits of a TIN are stored. Enter four digits, not the full number.' }
  const signedDate = isoDate(b.signedDate) ? b.signedDate : null
  return {
    input: {
      formType: b.formType,
      legalName: typeof b.legalName === 'string' && b.legalName.trim() ? b.legalName.trim().slice(0, 300) : null,
      tinType: (TIN_TYPES as readonly string[]).includes(String(b.tinType)) ? (b.tinType as TaxFormInput['tinType']) : null,
      tinLast4: digits.length === 4 ? digits : null,
      taxClassification: (TAX_CLASSIFICATIONS as readonly string[]).includes(String(b.taxClassification)) ? (b.taxClassification as TaxFormInput['taxClassification']) : null,
      country: typeof b.country === 'string' && b.country.trim() ? b.country.trim().slice(0, 100) : null,
      treatyClaimed: !!b.treatyClaimed,
      signedDate,
      expiresOn: isoDate(b.expiresOn) ? b.expiresOn : b.expiresOn === null ? null : defaultExpiry(b.formType, signedDate),
    },
  }
}

/** Whether this caller may write tax-form records at all. */
export async function canRecordTaxForms(admin: SupabaseClient, fundId: string, userId: string, role: string): Promise<{ access: AccessContext; can: boolean }> {
  const access = await loadAccessContext(admin, fundId, userId, role)
  // Tax forms are lp_capital gated on the tax_reporting feature (lib/access/route-domains.ts).
  return { access, can: hasAccess(access, 'lp_capital', 'write', 'tax_reporting') }
}

/** Write the record, linked to the verified document. One row per form received; history stays. */
export async function recordTaxForm(
  admin: SupabaseClient,
  args: { fundId: string; lpEntityId: string; documentId: string | null; userId: string; input: TaxFormInput },
): Promise<{ id: string } | { error: string }> {
  const { input } = args
  const { data, error } = await (admin as any)
    .from('lp_tax_forms')
    .insert({
      fund_id: args.fundId,
      lp_entity_id: args.lpEntityId,
      form_type: input.formType,
      tin_type: input.tinType,
      tin_last4: input.tinLast4,
      legal_name: input.legalName,
      tax_classification: input.taxClassification,
      country: input.country,
      treaty_claimed: input.treatyClaimed,
      signed_date: input.signedDate,
      expires_on: input.expiresOn,
      document_id: args.documentId,
      notes: 'Recorded at onboarding verification',
      created_by: args.userId,
    })
    .select('id').single()
  if (error || !data) return { error: error?.message ?? 'Insert failed' }
  return { id: data.id as string }
}
