import type { SupabaseClient } from '@supabase/supabase-js'

// Vendors — the payee dimension. See migration 20260904000005_vendors.sql.

export interface Vendor {
  id: string
  name: string
  is1099Eligible: boolean
  tinOnFile: boolean
  notes: string | null
}

/** The name as stored: trimmed, inner whitespace collapsed. Matching is case-insensitive in the index. */
export function normalizeVendorName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

const toVendor = (r: any): Vendor => ({
  id: r.id, name: r.name, is1099Eligible: !!r.is_1099_eligible, tinOnFile: !!r.tin_on_file, notes: r.notes ?? null,
})

export async function listVendors(admin: SupabaseClient, fundId: string): Promise<Vendor[]> {
  const { data } = await admin.from('vendors' as any).select('id, name, is_1099_eligible, tin_on_file, notes').eq('fund_id', fundId).order('name')
  return ((data as any[]) ?? []).map(toVendor)
}

/**
 * The vendor with this name, created if the fund has none — for the imports, where a name on a
 * row is the only thing known about the payee. Case-insensitive on the stored name.
 */
export async function ensureVendor(admin: SupabaseClient, fundId: string, rawName: string): Promise<Vendor | null> {
  const name = normalizeVendorName(rawName)
  if (!name) return null
  const { data: existing } = await admin
    .from('vendors' as any)
    .select('id, name, is_1099_eligible, tin_on_file, notes')
    .eq('fund_id', fundId)
    .ilike('name', name)
    .limit(1)
    .maybeSingle()
  if (existing) return toVendor(existing)
  const { data: created, error } = await admin
    .from('vendors' as any)
    .insert({ fund_id: fundId, name })
    .select('id, name, is_1099_eligible, tin_on_file, notes')
    .single()
  if (error || !created) {
    // A concurrent insert of the same name loses to the unique index; read it back.
    const { data: again } = await admin.from('vendors' as any).select('id, name, is_1099_eligible, tin_on_file, notes').eq('fund_id', fundId).ilike('name', name).limit(1).maybeSingle()
    return again ? toVendor(again) : null
  }
  return toVendor(created)
}

/** A memoised ensureVendor for an import loop — one lookup per distinct name, not per row. */
export function vendorResolver(admin: SupabaseClient, fundId: string) {
  const cache = new Map<string, string | null>()
  return async (rawName: string | null | undefined): Promise<string | null> => {
    const name = normalizeVendorName(rawName ?? '')
    if (!name) return null
    const key = name.toLowerCase()
    if (cache.has(key)) return cache.get(key)!
    const v = await ensureVendor(admin, fundId, name)
    cache.set(key, v?.id ?? null)
    return v?.id ?? null
  }
}

/** The vendor id if it belongs to this fund, else null — a client-supplied id is never trusted as-is. */
export async function vendorInFund(admin: SupabaseClient, fundId: string, vendorId: unknown): Promise<string | null> {
  if (typeof vendorId !== 'string' || !vendorId) return null
  const { data } = await admin.from('vendors' as any).select('id').eq('fund_id', fundId).eq('id', vendorId).maybeSingle()
  return data ? (data as any).id as string : null
}
