import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { encrypt } from '@/lib/crypto'
import { randomBytes } from 'crypto'

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const access = await assertAdminAccess(admin, user.id)
  if (access instanceof NextResponse) return access

  const { fundId, provider, postmarkInboundAddress, mailgunInboundDomain, mailgunSigningKey } = await req.json()

  if (!fundId || !provider) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (provider !== 'postmark' && provider !== 'mailgun') {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
  }

  if (fundId !== access.fundId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updates: Record<string, unknown> = {
    inbound_email_provider: provider,
  }

  if (provider === 'postmark') {
    if (!postmarkInboundAddress?.trim()) {
      return NextResponse.json({ error: 'Postmark inbound address is required' }, { status: 400 })
    }
    updates.postmark_inbound_address = postmarkInboundAddress.trim()
  }

  if (provider === 'mailgun') {
    if (!mailgunInboundDomain?.trim()) {
      return NextResponse.json({ error: 'Mailgun inbound domain is required' }, { status: 400 })
    }
    updates.mailgun_inbound_domain = mailgunInboundDomain.trim()

    // Encrypt signing key if provided
    if (mailgunSigningKey?.trim()) {
      const kek = process.env.ENCRYPTION_KEY
      if (!kek) return NextResponse.json({ error: 'Server misconfiguration: ENCRYPTION_KEY not set' }, { status: 500 })

      const { data: existing } = await admin
        .from('fund_settings')
        .select('encryption_key_encrypted')
        .eq('fund_id', fundId)
        .single()

      let dek: string
      if (existing?.encryption_key_encrypted) {
        const { decrypt } = await import('@/lib/crypto')
        dek = decrypt(existing.encryption_key_encrypted, kek)
      } else {
        dek = randomBytes(32).toString('hex')
        updates.encryption_key_encrypted = encrypt(dek, kek)
      }
      updates.mailgun_signing_key_encrypted = encrypt(mailgunSigningKey.trim(), dek)
    }
  }

  const { error } = await admin
    .from('fund_settings')
    .update(updates)
    .eq('fund_id', fundId)

  if (error) {
    return NextResponse.json({ error: 'Failed to save inbound email settings' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
