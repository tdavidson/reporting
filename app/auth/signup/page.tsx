import { createAdminClient } from '@/lib/supabase/admin'
import { SignUpForm } from './signup-form'

export const dynamic = 'force-dynamic'

async function getBranding() {
  try {
    const admin = createAdminClient()
    const { data: fund } = await admin
      .from('funds')
      .select('id, name, logo_url')
      .limit(1)
      .maybeSingle()

    if (!fund) return { fundName: '', fundLogo: '', authSubtitle: '', authContact: '' }

    const { data: settings } = await admin
      .from('fund_settings')
      .select('auth_subtitle, auth_contact')
      .eq('fund_id', fund.id)
      .maybeSingle()

    return {
      fundName: fund.name ?? '',
      fundLogo: fund.logo_url ?? '',
      authSubtitle: (settings as Record<string, unknown> | null)?.auth_subtitle as string ?? '',
      authContact: (settings as Record<string, unknown> | null)?.auth_contact as string ?? '',
    }
  } catch {
    return { fundName: '', fundLogo: '', authSubtitle: '', authContact: '' }
  }
}

export default async function SignUpPage() {
  const branding = await getBranding()
  return <SignUpForm branding={branding} />
}
