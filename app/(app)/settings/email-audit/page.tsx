import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EmailAuditList } from './email-audit-list'

export const metadata: Metadata = { title: 'Email audit' }

export default async function EmailAuditPage() {
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

  const { data: emails } = await admin
    .from('inbound_emails')
    .select('id, from_address, subject, received_at, routing_confidence, routing_reasoning, routing_secondary_label')
    .eq('fund_id', membership.fund_id)
    .eq('routed_to', 'audit')
    .order('received_at', { ascending: false })
    .limit(200)

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 max-w-4xl">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to settings
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Email audit</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Inbound emails the classifier labelled as "other" — newsletters, vendor pitches, auto-replies.
        Use Reroute on any row to recover an email that was wrongly dropped.
      </p>
      <EmailAuditList emails={(emails as any) ?? []} />
    </div>
  )
}
