import type { SupabaseClient } from '@supabase/supabase-js'
import { getOutboundConfig, sendOutboundEmail } from '@/lib/email'
import type { VCDealInsert } from './types'

function formatAmount(amount: number | null): string {
  if (!amount) return '—'
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`
  return `$${(amount / 1_000).toFixed(0)}K`
}

function buildDigestHtml(deals: VCDealInsert[], runDate: string): string {
  const rows = deals
    .map(
      (d) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#111827;font-weight:500;">${d.company_name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">${d.stage ?? '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">${formatAmount(d.amount_usd)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">${d.country ?? '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">${d.segment ?? '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;">
          ${d.source_url ? `<a href="${d.source_url}" style="color:#2563eb;text-decoration:none;">Source ↗</a>` : '—'}
        </td>
      </tr>`,
    )
    .join('')

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="700" cellpadding="0" cellspacing="0" style="max-width:700px;width:100%;background-color:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">

        <!-- Header -->
        <tr><td style="padding:28px 32px 0 32px;">
          <p style="margin:0 0 4px 0;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;">VC Market · Daily Digest</p>
          <h1 style="margin:0 0 6px 0;font-size:20px;font-weight:600;color:#111827;">
            ${deals.length} new deal${deals.length !== 1 ? 's' : ''} found
          </h1>
          <p style="margin:0 0 24px 0;font-size:13px;color:#6b7280;">Scraped on ${runDate}</p>
        </td></tr>

        <!-- Table -->
        <tr><td style="padding:0 32px 32px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
            <thead>
              <tr style="background-color:#f9fafb;">
                <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Company</th>
                <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Stage</th>
                <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Amount</th>
                <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Country</th>
                <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Segment</th>
                <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Source</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </td></tr>

        <!-- Footer -->
        ${siteUrl ? `
        <tr><td style="padding:20px 32px;border-top:1px solid #f3f4f6;">
          <a href="${siteUrl}/vc-market" style="display:inline-block;padding:10px 20px;background-color:#111827;color:#ffffff;font-size:13px;font-weight:500;text-decoration:none;border-radius:6px;">View in VC Market →</a>
        </td></tr>` : ''}

        <tr><td style="padding:16px 32px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:11px;color:#9ca3af;">Automated daily scrape · ${runDate}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/**
 * Send a digest email to a user.
 * Tries fund outbound config first; falls back to RESEND_API_KEY env var.
 * Fails silently — never throws.
 */
export async function sendDealDigest(
  admin: SupabaseClient,
  userId: string,
  fundId: string | null,
  newDeals: VCDealInsert[],
): Promise<void> {
  if (newDeals.length === 0) return

  try {
    // Resolve user email
    const { data: userData, error: userError } = await (admin as any).auth.admin.getUserById(userId)
    if (userError || !userData?.user?.email) {
      console.warn(`[deal-digest] Could not resolve email for user ${userId}`, userError?.message)
      return
    }

    // Try fund outbound config first, then fall back to RESEND_API_KEY env
    let config = null
    if (fundId) {
      config = await getOutboundConfig(admin, fundId)
    }
    if (!config) {
      const resendKey = process.env.RESEND_API_KEY
      if (resendKey) {
        config = { provider: 'resend' as const, apiKey: resendKey }
      }
    }
    if (!config) {
      console.warn(`[deal-digest] No email provider available for user ${userId} — skipping digest`)
      return
    }

    const runDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    const subject = `VC Market: ${newDeals.length} new deal${newDeals.length !== 1 ? 's' : ''} ready for review (${runDate})`
    const html = buildDigestHtml(newDeals, runDate)

    await sendOutboundEmail(config, {
      to: userData.user.email,
      subject,
      html,
    })

    console.log(`[deal-digest] Sent to ${userData.user.email} — ${newDeals.length} deals`)
  } catch (err) {
    console.error(`[deal-digest] Failed for user ${userId}:`, err)
  }
}
