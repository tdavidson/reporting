import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createFundAIProvider } from '@/lib/ai'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  try {
    const { provider } = await createFundAIProvider(admin, membership.fund_id)
    const models = await provider.listModels()
    return NextResponse.json({ models })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('not configured')) {
      return NextResponse.json({ models: [], error: 'Claude API key not configured.' })
    }
    return NextResponse.json({ models: [], error: message })
  }
}
