import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EmailRoutingTabs } from './email-routing-tabs'

export const metadata: Metadata = { title: 'Email routing' }

interface CorrectionRow {
  id: string
  original_label: string
  corrected_label: string
  created_at: string | null
}

export default async function EmailRoutingPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) redirect('/dashboard')
  if ((membership as any).role !== 'admin') redirect('/settings')

  const fundId = (membership as any).fund_id as string

  // Audit queue: inbound emails the classifier dropped to "other".
  const { data: emails } = await admin
    .from('inbound_emails')
    .select('id, from_address, subject, received_at, routing_confidence, routing_reasoning, routing_secondary_label')
    .eq('fund_id', fundId)
    .eq('routed_to', 'audit')
    .order('received_at', { ascending: false })
    .limit(200)

  // Accuracy: manual reroutes over the last 90 days.
  const since = new Date()
  since.setDate(since.getDate() - 90)
  const { data: corrections } = await admin
    .from('routing_corrections')
    .select('id, original_label, corrected_label, created_at')
    .eq('fund_id', fundId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })

  const rows = (corrections ?? []) as CorrectionRow[]
  const totalsByOriginal: Record<string, number> = {}
  const weeklyMap: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    totalsByOriginal[r.original_label] = (totalsByOriginal[r.original_label] ?? 0) + 1
    if (!r.created_at) continue
    const wk = isoWeekKey(new Date(r.created_at))
    weeklyMap[wk] = weeklyMap[wk] ?? {}
    const key = `${r.original_label}→${r.corrected_label}`
    weeklyMap[wk][key] = (weeklyMap[wk][key] ?? 0) + 1
  }
  const weekly = Object.keys(weeklyMap).sort().reverse().map(wk => {
    const flips = Object.entries(weeklyMap[wk]) as Array<[string, number]>
    return { wk, flips, total: flips.reduce((a, [, n]) => a + n, 0) }
  })

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 max-w-4xl">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to settings
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Email routing</h1>
      <p className="text-sm text-muted-foreground mb-6">
        The audit queue for emails the classifier wasn&apos;t sure about, and how its routing has been corrected over time.
      </p>
      <EmailRoutingTabs emails={(emails as any) ?? []} accuracy={{ totalsByOriginal, weekly }} />
    </div>
  )
}

function isoWeekKey(d: Date): string {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((+tmp - +yearStart) / 86400000) + 1) / 7)
  return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}
