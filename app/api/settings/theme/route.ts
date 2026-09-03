import { NextRequest, NextResponse } from 'next/server'
import { expireTag } from '@/lib/cache/tags'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ACCENT_PRESETS, FONT_OPTIONS, DISPLAY_FONT_OPTIONS, isValidHsl, type FundTheme } from '@/lib/theme'
import { dbError } from '@/lib/api-error'

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: m } = await admin.from('fund_members').select('fund_id, role').eq('user_id', user.id).maybeSingle()
  if (!m) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  return { admin, fundId: (m as any).fund_id as string, role: (m as any).role as string }
}

export async function GET() {
  const c = await ctx()
  if ('error' in c) return c.error
  const { data } = await (c.admin as any).from('fund_settings').select('theme').eq('fund_id', c.fundId).maybeSingle()
  return NextResponse.json({ theme: (data?.theme ?? null) as FundTheme | null })
}

export async function PATCH(req: NextRequest) {
  const c = await ctx()
  if ('error' in c) return c.error
  if (c.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const raw = body.theme

  // Sanitize: only curated accent presets / known font keys / sane radius.
  let theme: FundTheme | null = null
  if (raw && typeof raw === 'object') {
    const t: FundTheme = {}
    // Accept a curated preset or any valid custom "h s% l%" brand color.
    if (typeof raw.accent === 'string' && (ACCENT_PRESETS.some(p => p.hsl === raw.accent) || isValidHsl(raw.accent))) t.accent = raw.accent
    if (typeof raw.font === 'string' && FONT_OPTIONS.some(o => o.key === raw.font) && raw.font !== 'system') t.font = raw.font
    // 'inter' is the default, so storing it would be a no-op override.
    if (typeof raw.displayFont === 'string' && DISPLAY_FONT_OPTIONS.some(o => o.key === raw.displayFont) && raw.displayFont !== 'inter') t.displayFont = raw.displayFont
    if (typeof raw.radius === 'number' && raw.radius >= 0 && raw.radius <= 2) t.radius = raw.radius
    const hasAny = !!t.accent || !!t.font || !!t.displayFont || typeof t.radius === 'number'
    theme = hasAny ? t : null
  }

  const { error } = await (c.admin as any).from('fund_settings').update({ theme }).eq('fund_id', c.fundId)
  if (error) return dbError(error, 'settings-theme')
  expireTag('fund-settings')
  return NextResponse.json({ ok: true, theme })
}
