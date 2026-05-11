import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Routing accuracy' }

interface CorrectionRow {
  id: string
  original_label: string
  corrected_label: string
  created_at: string | null
}

const LABELS = ['reporting', 'interactions', 'deals', 'audit', 'other'] as const

export default async function RoutingAccuracyPage() {
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

  // Fetch the last 90 days of corrections.
  const since = new Date()
  since.setDate(since.getDate() - 90)

  const { data: corrections } = await admin
    .from('routing_corrections')
    .select('id, original_label, corrected_label, created_at')
    .eq('fund_id', membership.fund_id)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })

  const rows = (corrections ?? []) as CorrectionRow[]

  // Bucket by ISO week.
  const weekly: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    if (!r.created_at) continue
    const wk = isoWeekKey(new Date(r.created_at))
    weekly[wk] = weekly[wk] ?? {}
    const key = `${r.original_label}→${r.corrected_label}`
    weekly[wk][key] = (weekly[wk][key] ?? 0) + 1
  }
  const weekKeys = Object.keys(weekly).sort().reverse()

  // Total flips by original label.
  const totalsByOriginal: Record<string, number> = {}
  for (const r of rows) {
    totalsByOriginal[r.original_label] = (totalsByOriginal[r.original_label] ?? 0) + 1
  }

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 max-w-4xl">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to settings
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Routing accuracy</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Manual reroutes over the last 90 days. Spikes indicate prompt drift or new edge cases the classifier doesn't handle yet.
      </p>

      <div className="rounded-md border bg-card p-4 mb-6">
        <h2 className="text-sm font-medium mb-3">Total corrections by original label</h2>
        {Object.keys(totalsByOriginal).length === 0 ? (
          <p className="text-sm text-muted-foreground">No corrections yet.</p>
        ) : (
          <div className="space-y-2">
            {LABELS.map(l => {
              const count = totalsByOriginal[l] ?? 0
              const max = Math.max(...Object.values(totalsByOriginal), 1)
              const pct = (count / max) * 100
              return (
                <div key={l} className="flex items-center gap-3">
                  <span className="w-28 text-sm capitalize">{l}</span>
                  <div className="flex-1 bg-muted rounded h-5 relative overflow-hidden">
                    <div className="bg-primary h-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-10 text-right text-sm text-muted-foreground">{count}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="rounded-md border bg-card overflow-hidden">
        <h2 className="text-sm font-medium p-4 pb-2">Weekly corrections</h2>
        {weekKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4">No weekly data.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left text-xs uppercase font-medium text-muted-foreground">Week</th>
                <th className="px-3 py-2 text-left text-xs uppercase font-medium text-muted-foreground">Flips</th>
                <th className="px-3 py-2 text-right text-xs uppercase font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {weekKeys.map(wk => {
                const flips = Object.entries(weekly[wk])
                const total = flips.reduce((acc, [, n]) => acc + n, 0)
                return (
                  <tr key={wk} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{wk}</td>
                    <td className="px-3 py-2 text-xs">
                      {flips.map(([k, n]) => (
                        <span key={k} className="inline-block mr-3">
                          <span className="font-mono">{k}</span> ×{n}
                        </span>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-right">{total}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function isoWeekKey(d: Date): string {
  // ISO week-numbering year + week number (1-53)
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((+tmp - +yearStart) / 86400000) + 1) / 7)
  return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}
