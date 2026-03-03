import { NextResponse } from 'next/server'

export async function GET() {
  const email = process.env.DEMO_USER_EMAIL
  const password = process.env.DEMO_USER_PASSWORD

  if (!email || !password) {
    return NextResponse.json({ error: 'Demo not configured' }, { status: 404 })
  }

  return NextResponse.json({ email, password })
}
