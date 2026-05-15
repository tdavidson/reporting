import { createClient } from '@/lib/supabase/client'

/**
 * Upload a single diligence document to a deal using the direct-to-storage
 * pattern. The browser pulls a signed upload URL from /upload-url, uploads
 * directly to Supabase Storage (bypassing Vercel's ~4.5 MB function body
 * limit), then calls the documents endpoint with the storage path to record
 * the row. Returns the inserted document row on success.
 *
 * Both the New Deal dialog and the Deal Room tab use this helper so the
 * upload behaviour is consistent.
 */
export async function uploadDiligenceDocument(dealId: string, file: File): Promise<any> {
  const urlRes = await fetch(`/api/diligence/${dealId}/documents/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: file.name }),
  })
  if (!urlRes.ok) {
    const body = await urlRes.json().catch(() => ({}))
    throw new Error(body.error ?? 'Failed to prepare upload')
  }
  const { storage_path, token } = await urlRes.json() as { storage_path: string; token: string }

  const supabase = createClient()
  const { error: upErr } = await supabase.storage
    .from('diligence-documents')
    .uploadToSignedUrl(storage_path, token, file, { contentType: file.type || 'application/octet-stream' })
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`)

  const finalRes = await fetch(`/api/diligence/${dealId}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storage_path,
      file_name: file.name,
      content_type: file.type || 'application/octet-stream',
    }),
  })
  if (!finalRes.ok) {
    const body = await finalRes.json().catch(() => ({}))
    throw new Error(body.error ?? 'Upload failed')
  }
  return finalRes.json()
}
