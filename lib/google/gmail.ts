const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export async function sendEmail(
  accessToken: string,
  to: string,
  subject: string,
  htmlBody: string,
  cc?: string,
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

  // Omit From: — Gmail fills it with the authenticated user. Avoids needing
  // a profile-read scope (gmail.send alone can't call users.getProfile).
  const headers = [`To: ${to}`]
  if (cc?.trim()) headers.push(`Cc: ${cc.trim()}`)
  headers.push(
    `Subject: ${subject}`,
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
