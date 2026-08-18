import { redirect } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent } from '@/components/ui/card'
import { Clock } from 'lucide-react'

export default async function PendingPage() {
  const supabase = createClient()
  const user = await getUser()
  if (!user) redirect('/auth')

  // Check if already approved (became a member)
  const { data: fundSettings } = await supabase
    .from('fund_settings')
    .select('id')
    .limit(1)
    .maybeSingle()

  if (fundSettings) redirect('/dashboard')

  // Get the pending request details
  const admin = createAdminClient()
  const { data: request } = await admin
    .from('fund_join_requests')
    .select('id, status, fund_id, funds(name)')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle() as { data: { id: string; status: string; fund_id: string; funds: { name: string } } | null }

  if (!request) redirect('/onboarding')

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Pending Approval</h1>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <Clock className="h-12 w-12 text-muted-foreground mx-auto" />
              <div>
                <p className="font-medium">
                  Your request to join <span className="text-primary">{request.funds?.name}</span> is pending approval.
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  A fund administrator will review your request. You&apos;ll be able to access the dashboard once approved.
                </p>
              </div>

              <form action="/api/auth/logout" method="POST" className="pt-2">
                <button
                  type="submit"
                  className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Sign out
                </button>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
