// Uploads nobody finished with.
//
// The batch sorter uploads first and files on confirm; an admin who closes the tab mid-review
// leaves files in the fund's storage folder with no document row. The LP path is the same
// between the signed-URL upload and the record. This sweeps them: anything in the fund's folder
// (the root and the onboarding subfolders) older than a day that no lp_documents row points at.
// Runs from the daily ops cron. Never throws — a failed sweep is a warning, not a failed digest.

import type { SupabaseClient } from '@supabase/supabase-js'

const MIN_AGE_MS = 24 * 60 * 60 * 1000
const PAGE = 1000

async function listFolder(admin: SupabaseClient, folder: string): Promise<{ name: string; created_at: string | null; isFolder: boolean }[]> {
  const { data, error } = await admin.storage.from('lp-documents').list(folder, { limit: PAGE, sortBy: { column: 'created_at', order: 'asc' } })
  if (error || !data) return []
  // Storage lists a subfolder as an entry with no id and no metadata.
  return data.map(o => ({ name: o.name, created_at: (o as any).created_at ?? null, isFolder: !(o as any).id }))
}

export async function sweepOrphanedUploads(admin: SupabaseClient, fundId: string, now: number = Date.now()): Promise<{ removed: number; checked: number }> {
  const a = admin as any
  const result = { removed: 0, checked: 0 }
  try {
    // The fund's root folder holds sorter uploads; onboarding/<entity>/ holds the LP's.
    const candidates: string[] = []
    const root = await listFolder(admin, fundId)
    for (const o of root) {
      if (o.isFolder) continue
      if (o.created_at && now - new Date(o.created_at).getTime() < MIN_AGE_MS) continue
      candidates.push(`${fundId}/${o.name}`)
    }
    if (root.some(o => o.isFolder && o.name === 'onboarding')) {
      for (const ent of await listFolder(admin, `${fundId}/onboarding`)) {
        if (!ent.isFolder) continue
        for (const o of await listFolder(admin, `${fundId}/onboarding/${ent.name}`)) {
          if (o.isFolder) continue
          if (o.created_at && now - new Date(o.created_at).getTime() < MIN_AGE_MS) continue
          candidates.push(`${fundId}/onboarding/${ent.name}/${o.name}`)
        }
      }
    }
    result.checked = candidates.length
    if (candidates.length === 0) return result

    const referenced = new Set<string>()
    for (let i = 0; i < candidates.length; i += 200) {
      const slice = candidates.slice(i, i + 200)
      const { data } = await a.from('lp_documents').select('storage_path').eq('fund_id', fundId).in('storage_path', slice)
      for (const r of (data ?? []) as { storage_path: string }[]) referenced.add(r.storage_path)
    }
    const orphans = candidates.filter(p => !referenced.has(p))
    if (orphans.length === 0) return result
    const { error } = await admin.storage.from('lp-documents').remove(orphans)
    if (error) console.warn('[onboarding sweep] remove failed:', error.message)
    else result.removed = orphans.length
  } catch (e) {
    console.warn('[onboarding sweep] failed:', e instanceof Error ? e.message : e)
  }
  return result
}
