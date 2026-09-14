import type { CSSProperties } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseSiteContent, siteFontCssVars, SITE_FONT_DEFAULT } from '@/lib/marketing/content'
import { PublicLayoutClient } from './public-shell'

/**
 * Server shell for the public pages. Its one job is the marketing page's font:
 * site_content.font is chosen in Settings → Marketing, separately from any
 * fund's Appearance theme (which never applies out here — the (app) layout is
 * what reads fund_settings.theme). The variables are set on a wrapper rather
 * than <html> so the choice cannot leak into the app for a signed-in user.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const admin = createAdminClient()
  const { data } = await (admin as any).from('site_content').select('content').eq('id', true).maybeSingle()
  const font = parseSiteContent(data?.content)?.font ?? SITE_FONT_DEFAULT
  const vars = siteFontCssVars(font)
  const style = Object.fromEntries(vars.split(';').filter(Boolean).map(kv => {
    const i = kv.indexOf(':')
    return [kv.slice(0, i), kv.slice(i + 1)]
  })) as CSSProperties

  return (
    <div style={style} className="font-sans">
      <PublicLayoutClient>{children}</PublicLayoutClient>
    </div>
  )
}
