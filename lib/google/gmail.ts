const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface GmailAttachment { filename: string; content: Buffer; contentType: string }

// RFC 2047-encode a header value when it contains non-ASCII, and strip CR/LF so
// it can't inject extra headers. ASCII-only values pass through unchanged.
function encodeMimeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ')
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(clean)) return clean
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`
}

// A MIME parameter value (e.g. a filename) used inside double quotes: drop the
// quotes/backslashes/newlines that would break the header. Non-ASCII is
// RFC 2047-encoded for broad client compatibility.
function encodeMimeParam(value: string): string {
  const clean = value.replace(/["\\\r\n]+/g, '_')
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(clean)) return clean
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`
}

// An address-list header value (To/Cc/Bcc). Addresses must stay literal — RFC 2047
// encoding the whole list would mangle them — so this only strips the CR/LF that
// would otherwise let a crafted address inject extra MIME headers.
function encodeAddressList(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

export async function sendEmail(
  accessToken: string,
  to: string,
  subject: string,
  htmlBody: string,
  cc?: string,
  bcc?: string,
  attachments?: GmailAttachment[],
): Promise<{ id: string; threadId: string }> {
  // Send as plain text (Content-Type: text/plain) so Gmail applies its own
  // formatting — line breaks, link detection, etc.  We strip any HTML tags
  // that might have snuck in, keeping the raw text the user typed.
  const plainBody = htmlBody
    .replace(/<br\s*\/?>\r?\n?/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

  // With attachments we must build a multipart/mixed MIME message; the plain
  // body becomes the first part and each attachment a base64 part.
  if (attachments && attachments.length > 0) {
    const { randomUUID } = await import('crypto')
    const boundary = `mixed_${randomUUID().replace(/-/g, '')}`
    const head = [`To: ${encodeAddressList(to)}`]
    if (cc?.trim()) head.push(`Cc: ${encodeAddressList(cc)}`)
    if (bcc?.trim()) head.push(`Bcc: ${encodeAddressList(bcc)}`)
    head.push(
      `Subject: ${encodeMimeHeader(subject)}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
    )
    const parts: string[] = [
      // Blank line (CRLF CRLF) separates the outer headers from the body.
      head.join('\r\n') + '\r\n\r\n',
      `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${plainBody}\r\n`,
    ]
    for (const a of attachments) {
      const b64 = a.content.toString('base64').replace(/(.{76})/g, '$1\r\n')
      const name = encodeMimeParam(a.filename)
      parts.push(
        `--${boundary}\r\n` +
        `Content-Type: ${a.contentType}; name="${name}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${name}"\r\n\r\n` +
        `${b64}\r\n`,
      )
    }
    parts.push(`--${boundary}--`)
    const rawMixed = parts.join('')
    const encodedMixed = Buffer.from(rawMixed).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const resMixed = await fetch(`${GMAIL_API}/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encodedMixed }),
    })
    if (!resMixed.ok) {
      const text = await resMixed.text()
      throw new Error(`Failed to send email to ${to}: ${text}`)
    }
    return resMixed.json()
  }

  // Omit From: — Gmail fills it with the authenticated user. Avoids needing
  // a profile-read scope (gmail.send alone can't call users.getProfile).
  const headers = [`To: ${encodeAddressList(to)}`]
  if (cc?.trim()) headers.push(`Cc: ${encodeAddressList(cc)}`)
  if (bcc?.trim()) headers.push(`Bcc: ${encodeAddressList(bcc)}`)
  headers.push(
    `Subject: ${encodeMimeHeader(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
  )

  const raw = [...headers, '', plainBody].join('\r\n')

  const encodedMessage = Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encodedMessage }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to send email to ${to}: ${text}`)
  }

  return res.json()
}
