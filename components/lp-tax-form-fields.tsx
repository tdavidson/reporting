'use client'

import { Input } from '@/components/ui/input'
import { TAX_FORM_TYPES, TAX_FORM_LABEL, defaultExpiry, type TaxFormType } from '@/lib/tax/forms'
import { TAX_CLASSIFICATIONS, TIN_TYPES } from '@/lib/lp-onboarding-tax'

export interface TaxFormFieldsValue {
  formType: TaxFormType | ''
  legalName: string
  tinType: string
  tinLast4: string
  taxClassification: string
  country: string
  treatyClaimed: boolean
  signedDate: string
  expiresOn: string
}

export const EMPTY_TAX_FIELDS: TaxFormFieldsValue = {
  formType: '', legalName: '', tinType: '', tinLast4: '', taxClassification: '', country: '', treatyClaimed: false, signedDate: '', expiresOn: '',
}

/** Turn what the reader found into a starting point; anything it didn't find stays blank. */
export function taxFieldsFromFacts(f: { formType?: string | null; legalName?: string | null; tinType?: string | null; tinLast4?: string | null; country?: string | null; signedDate?: string | null; expiresOn?: string | null } | null | undefined): TaxFormFieldsValue {
  if (!f) return EMPTY_TAX_FIELDS
  const formType = (TAX_FORM_TYPES as string[]).includes(String(f.formType)) ? (f.formType as TaxFormType) : ''
  return {
    formType,
    legalName: f.legalName ?? '',
    tinType: f.tinType ?? '',
    tinLast4: f.tinLast4 ?? '',
    taxClassification: '',
    country: f.country ?? '',
    treatyClaimed: false,
    signedDate: f.signedDate ?? '',
    expiresOn: f.expiresOn ?? (formType && f.signedDate ? defaultExpiry(formType, f.signedDate) ?? '' : ''),
  }
}

const CLASS_LABEL: Record<string, string> = {
  individual: 'Individual', c_corp: 'C corporation', s_corp: 'S corporation', partnership: 'Partnership', trust_estate: 'Trust / estate',
  llc: 'LLC', disregarded_entity: 'Disregarded entity', exempt_organization: 'Exempt organization', government: 'Government', other: 'Other',
}

/**
 * The facts behind a partner's tax form, as they appear ON THE FORM. Used wherever a form is
 * verified — the batch sorter and the checklist review — so the record is made once, there.
 * Only the last four digits of a TIN are ever asked for.
 */
export function TaxFormFields({ value, onChange, disabled }: { value: TaxFormFieldsValue; onChange: (v: TaxFormFieldsValue) => void; disabled?: boolean }) {
  const set = (patch: Partial<TaxFormFieldsValue>) => {
    const next = { ...value, ...patch }
    // Changing the form or the date re-proposes the expiry unless the reviewer has typed one.
    if ((patch.formType !== undefined || patch.signedDate !== undefined) && next.formType && !value.expiresOn) {
      next.expiresOn = defaultExpiry(next.formType, next.signedDate || null) ?? ''
    }
    onChange(next)
  }
  const isW8 = value.formType && value.formType !== 'w9'
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
      <label className="text-muted-foreground">Form
        <select value={value.formType} onChange={e => set({ formType: e.target.value as TaxFormType | '' })} disabled={disabled} className="mt-1 block h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
          <option value="">Select…</option>
          {TAX_FORM_TYPES.map(t => <option key={t} value={t}>{TAX_FORM_LABEL[t]}</option>)}
        </select>
      </label>
      <label className="text-muted-foreground">Legal name, as on the form
        <Input value={value.legalName} onChange={e => set({ legalName: e.target.value })} disabled={disabled} className="mt-1 h-8 text-xs" />
      </label>
      <label className="text-muted-foreground">TIN type
        <select value={value.tinType} onChange={e => set({ tinType: e.target.value })} disabled={disabled} className="mt-1 block h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
          <option value="">—</option>
          {TIN_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
        </select>
      </label>
      <label className="text-muted-foreground">TIN, last four digits only
        <Input value={value.tinLast4} inputMode="numeric" maxLength={4} onChange={e => set({ tinLast4: e.target.value.replace(/\D/g, '').slice(0, 4) })} disabled={disabled} placeholder="1234" className="mt-1 h-8 w-24 text-xs tabular-nums" />
      </label>
      <label className="text-muted-foreground">Classification
        <select value={value.taxClassification} onChange={e => set({ taxClassification: e.target.value })} disabled={disabled} className="mt-1 block h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
          <option value="">—</option>
          {TAX_CLASSIFICATIONS.map(c => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
        </select>
      </label>
      {isW8 ? (
        <label className="text-muted-foreground">Country
          <Input value={value.country} onChange={e => set({ country: e.target.value })} disabled={disabled} className="mt-1 h-8 text-xs" />
        </label>
      ) : <span />}
      <label className="text-muted-foreground">Signed
        <Input type="date" value={value.signedDate} onChange={e => set({ signedDate: e.target.value })} disabled={disabled} className="mt-1 h-8 w-40 text-xs" />
      </label>
      <label className="text-muted-foreground">Valid until <span className="text-[10px]">(blank = does not expire)</span>
        <Input type="date" value={value.expiresOn} onChange={e => onChange({ ...value, expiresOn: e.target.value })} disabled={disabled} className="mt-1 h-8 w-40 text-xs" />
      </label>
      {isW8 && (
        <label className="inline-flex items-center gap-2 text-muted-foreground sm:col-span-2">
          <input type="checkbox" checked={value.treatyClaimed} onChange={e => set({ treatyClaimed: e.target.checked })} disabled={disabled} /> Treaty benefits claimed
        </label>
      )}
    </div>
  )
}

/** The request body the routes accept, or null when the reviewer left the form unset. */
export function taxFieldsToBody(v: TaxFormFieldsValue) {
  if (!v.formType) return null
  return {
    formType: v.formType, legalName: v.legalName || null, tinType: v.tinType || null, tinLast4: v.tinLast4 || null,
    taxClassification: v.taxClassification || null, country: v.country || null, treatyClaimed: v.treatyClaimed,
    signedDate: v.signedDate || null, expiresOn: v.expiresOn || null,
  }
}
