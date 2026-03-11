import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_SUBMIT_MS = 2000 // reject submissions faster than 2s

export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP (DB-backed, works across serverless instances)
    const limited = await rateLimit({ key: `contact:${getClientIp(request)}`, limit: 3, windowSeconds: 60 })
    if (limited) return limited

    const { name, email, message, website, t } = await request.json()

    // Honeypot — bots fill this hidden field
    if (website) {
      return NextResponse.json({ ok: true }) // silent success so bots don't retry
    }

    // Timing check — reject if submitted too fast
    if (t && Date.now() - t < MIN_SUBMIT_MS) {
      return NextResponse.json({ ok: true })
    }

    if (!name || !email || !message) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    if (typeof name !== 'string' || name.length > 200) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    }

    if (typeof message !== 'string' || message.length > 5000) {
      return NextResponse.json({ error: 'Message is too long' }, { status: 400 })
    }

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 })
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      console.error('[contact] RESEND_API_KEY not configured')
      return NextResponse.json({ error: 'Email service not configured' }, { status: 500 })
    }

    const to = process.env.CONTACT_EMAIL || 'hello@hemrock.com'
    const from = process.env.CONTACT_FROM || 'onboarding@resend.dev'

    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)

    await resend.emails.send({
      from,
      to,
      replyTo: email,
      subject: `Contact form: ${name}`,
      html: `
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
      `,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[contact] Failed to send:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
