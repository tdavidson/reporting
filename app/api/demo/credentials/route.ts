import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Rate limit: 10 requests per 5 minutes per IP
  const limited = await rateLimit({ key: `demo-creds:${getClientIp(req)}`, limit: 10, windowSeconds: 300 })
  if (limited) return limited

  const deployKey = process.env.MARKETING_DEPLOYMENT_KEY
  if (process.env.NEXT_PUBLIC_ENABLE_MARKETING_SITE !== 'true' || !deployKey) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Validate request token against deployment key or public demo key
  const incoming = req.headers.get('x-deployment-key') ?? ''
  const demoKey = process.env.NEXT_PUBLIC_DEMO_KEY ?? ''
  const validKeys = [deployKey, ...(demoKey ? [demoKey] : [])]
  const isValid = validKeys.some(key =>
    incoming && incoming.length === key.length && timingSafeEqual(Buffer.from(incoming), Buffer.from(key))
  )
  if (!isValid) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const email = process.env.DEMO_USER_EMAIL
  const password = process.env.DEMO_USER_PASSWORD

  if (!email || !password) {
    return NextResponse.json({ error: 'Demo not configured' }, { status: 404 })
  }

  return NextResponse.json({ email, password })
}
