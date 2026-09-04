import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/crypto'
import { sendTwilioMessage, splitMessage } from './twilio'

/**
 * A fund's text-messaging configuration, decrypted and ready to use.
 *
 * `provider` is the seam. The tables, the webhook handler and the Settings UI know nothing
 * Twilio-specific beyond this file and lib/messaging/twilio.ts; a blue-bubble bridge (Sendblue,
 * LoopMessage) or a second SMS carrier is another arm here and its own adapter file.
 */
export type SmsProvider = 'twilio'

export interface SmsConfig {
  provider: SmsProvider
  /** The number members text, E.164. Replies go out from it. */
  fromNumber: string
  accountSid: string
  authToken: string
}

interface SmsSettingsRow {
  fund_id: string
  sms_provider: string | null
  sms_from_number: string | null
  twilio_account_sid: string | null
  twilio_auth_token_encrypted: string | null
  encryption_key_encrypted: string | null
}

const SMS_COLUMNS = 'fund_id, sms_provider, sms_from_number, twilio_account_sid, twilio_auth_token_encrypted, encryption_key_encrypted'

function decryptConfig(row: SmsSettingsRow): SmsConfig | null {
  if (row.sms_provider !== 'twilio') return null
  if (!row.sms_from_number || !row.twilio_account_sid || !row.twilio_auth_token_encrypted || !row.encryption_key_encrypted) {
    return null
  }
  const kek = process.env.ENCRYPTION_KEY
  if (!kek) {
    console.error('[messaging] ENCRYPTION_KEY not set; text messaging is unavailable')
    return null
  }
  try {
    const dek = decrypt(row.encryption_key_encrypted, kek)
    return {
      provider: 'twilio',
      fromNumber: row.sms_from_number,
      accountSid: row.twilio_account_sid,
      authToken: decrypt(row.twilio_auth_token_encrypted, dek),
    }
  } catch (error) {
    console.error('[messaging] could not decrypt the Twilio auth token:', error)
    return null
  }
}

/** The fund's config, or null when texting is not (fully) set up. */
export async function loadSmsConfig(admin: SupabaseClient, fundId: string): Promise<SmsConfig | null> {
  const { data, error } = await (admin as any)
    .from('fund_settings')
    .select(SMS_COLUMNS)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? decryptConfig(data as SmsSettingsRow) : null
}

/**
 * Which fund owns the number that was texted. The webhook's first question, and the one that
 * decides whose auth token verifies the signature — so it is answered before the signature is
 * looked at, and a number no fund claims is answered with nothing at all.
 */
export async function findFundBySmsNumber(
  admin: SupabaseClient,
  toNumber: string,
): Promise<{ fundId: string; config: SmsConfig } | null> {
  const { data, error } = await (admin as any)
    .from('fund_settings')
    .select(SMS_COLUMNS)
    .eq('sms_from_number', toNumber)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const config = decryptConfig(data as SmsSettingsRow)
  return config ? { fundId: (data as SmsSettingsRow).fund_id, config } : null
}

export interface SentMessage {
  providerMessageId: string | null
  body: string
}

/**
 * Send `body` to `to`, split into deliverable pieces, in order. Returns what was sent so the
 * caller can log it; throws on the first piece that fails so a half-delivered answer is logged as
 * exactly that rather than as success.
 */
export async function sendSms(
  config: SmsConfig,
  to: string,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SentMessage[]> {
  const sent: SentMessage[] = []
  for (const piece of splitMessage(body)) {
    switch (config.provider) {
      case 'twilio': {
        const result = await sendTwilioMessage(
          { accountSid: config.accountSid, authToken: config.authToken },
          { from: config.fromNumber, to, body: piece },
          fetchImpl,
        )
        sent.push({ providerMessageId: result.sid, body: piece })
        break
      }
    }
  }
  return sent
}
