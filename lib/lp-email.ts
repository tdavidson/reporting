// The one LP-facing email layout: a fund name, a title, a message, an optional portal button.
//
// Statements, letters, documents, notices and receipts all go out in this frame, so an LP sees
// one family of emails from their fund rather than a different design per route. Pure HTML
// assembly; the sending is the caller's.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export function buildLpEmailHtml(opts: {
  fundName: string
  itemTitle: string
  message: string
  link: string | null
  /** The button's label. Defaults to "View in your portal". */
  linkLabel?: string
  /** Rows under the message — an amount, a due date — rendered as a small key/value table. */
  facts?: { label: string; value: string }[]
}): string {
  const { fundName, message, link, itemTitle } = opts
  const body = esc(message).replace(/\r?\n/g, '<br>')
  const facts = opts.facts && opts.facts.length > 0
    ? `<table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border-collapse:collapse;">${opts.facts.map(f => `
        <tr><td style="padding:4px 16px 4px 0;font-size:13px;color:#6b7280;">${esc(f.label)}</td><td style="padding:4px 0;font-size:13px;color:#111827;font-variant-numeric:tabular-nums;">${esc(f.value)}</td></tr>`).join('')}
      </table>`
    : ''
  const button = link
    ? `<table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;"><tr><td style="background-color:#111827;border-radius:6px;padding:12px 24px;">
        <a href="${esc(link)}" style="color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;display:inline-block;">${esc(opts.linkLabel ?? 'View in your portal')}</a>
      </td></tr></table>
      <p style="margin:0 0 24px 0;font-size:12px;color:#6b7280;word-break:break-all;">Or copy this link: ${esc(link)}</p>`
    : ''
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
        <tr><td style="padding:32px 32px 0 32px;">
          <p style="margin:0;font-size:13px;color:#6b7280;">${esc(fundName)}</p>
        </td></tr>
        <tr><td style="padding:20px 32px 32px 32px;">
          <h1 style="margin:0 0 16px 0;font-size:20px;font-weight:600;color:#111827;">${esc(itemTitle)}</h1>
          ${body ? `<div style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#374151;">${body}</div>` : ''}
          ${facts}
          ${button}
          <p style="margin:0;font-size:12px;color:#9ca3af;">If you weren't expecting this email, you can safely ignore it.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:11px;color:#9ca3af;">Sent by ${esc(fundName)} via their reporting portal.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
