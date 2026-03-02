import type { SupabaseClient } from '@supabase/supabase-js'

interface GoogleCredentials {
  clientId: string
  clientSecret: string
}

/**
 * Get Google OAuth credentials for a fund from the database.
 */
export async function getGoogleCredentials(
  admin: SupabaseClient,
  fundId: string
): Promise<GoogleCredentials | null> {
  const { data: settings } = await admin
    .from('fund_settings')
    .select('google_client_id, google_client_secret_encrypted, encryption_key_encrypted')
    .eq('fund_id', fundId)
    .single()

  if (settings?.google_client_id && settings?.google_client_secret_encrypted && settings?.encryption_key_encrypted) {
    const kek = process.env.ENCRYPTION_KEY
    if (kek) {
      const { decrypt } = await import('@/lib/crypto')
      const dek = decrypt(settings.encryption_key_encrypted, kek)
      const clientSecret = decrypt(settings.google_client_secret_encrypted, dek)
      return {
        clientId: settings.google_client_id,
        clientSecret,
      }
    }
  }

  return null
}
