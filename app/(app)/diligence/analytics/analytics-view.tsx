'use client'

import { useEffect, useState } from 'react'
import { Loader2, BarChart3 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Analytics {
  summary: { total: number; active: number; passed: number; won: number; lost: number; on_hold: number }
  by_sector: Array<{ sector: string; total: number; won: number; lost: number; passed: number; active: number }>
  by_partner: Array<{ partner_id: string; partner_name: string | null; total: number; active: number; won: number; lost: number; passed: number }>
  funnel: { created: number; has_ingestion: number; has_research: number; has_qa: number; has_memo_draft: number; finalized: number; won: number }
  time_in_stage: {
    median_days_created_to_draft: number | null
    median_days_draft_to_final: number | null
    sample_created_to_draft: number
    sample_draft_to_final: number
  }
}

export function AnalyticsView() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/diligence/analytics')
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-5 w-5" /> Diligence Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Status mix, conversion funnel, time-in-stage, throughput by partner. Updates live as deals move.
        </p>
      </div>

      {loading || !data ? (
        <div className="rounded-md border bg-card p-12 text-center text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading…
        </div>
      ) : data.summary.total === 0 ? (
        <div className="rounded-md border bg-card p-12 text-center text-sm text-muted-foreground">
          No deals yet. Analytics populate as you create and progress deals.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary chips — neutral; the label distinguishes status. */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <Stat label="Total deals" value={data.summary.total} />
            <Stat label="Active" value={data.summary.active} />
            <Stat label="Won" value={data.summary.won} />
            <Stat label="Lost" value={data.summary.lost} />
            <Stat label="Passed" value={data.summary.passed} />
            <Stat label="On hold" value={data.summary.on_hold} />
          </div>

          {/* Funnel */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Agent funnel</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                How many deals reach each agent stage. Drop-offs at any step suggest either friction in the workflow or partners passing on deals during the run.
              </p>
              <Funnel funnel={data.funnel} />
            </CardContent>
          </Card>

          {/* Time-in-stage */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Time in stage</CardTitle></CardHeader>
            <CardContent className="text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">Created → first memo draft (median)</div>
                  <div className="text-2xl font-semibold tracking-tight">
                    {data.time_in_stage.median_days_created_to_draft !== null
                      ? `${data.time_in_stage.median_days_created_to_draft.toFixed(1)} days`
                      : '—'}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">n = {data.time_in_stage.sample_created_to_draft}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Draft → finalized (median)</div>
                  <div className="text-2xl font-semibold tracking-tight">
                    {data.time_in_stage.median_days_draft_to_final !== null
                      ? `${data.time_in_stage.median_days_draft_to_final.toFixed(1)} days`
                      : '—'}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">n = {data.time_in_stage.sample_draft_to_final}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* By sector */}
          {data.by_sector.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">By sector</CardTitle></CardHeader>
              <CardContent>
                <div style={{ width: '100%', height: Math.max(180, data.by_sector.length * 40) }}>
                  <ResponsiveContainer>
                    <BarChart data={data.by_sector} layout="vertical" margin={{ top: 8, right: 16, left: 16, bottom: 8 }}>
                      <XAxis type="number" />
                      <YAxis dataKey="sector" type="category" width={140} />
                      <Tooltip />
                      <Bar dataKey="total" fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* By partner */}
          {data.by_partner.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">By lead partner</CardTitle></CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Partner</th>
                        <th className="px-3 py-2 text-right font-medium">Total</th>
                        <th className="px-3 py-2 text-right font-medium">Active</th>
                        <th className="px-3 py-2 text-right font-medium">Won</th>
                        <th className="px-3 py-2 text-right font-medium">Lost</th>
                        <th className="px-3 py-2 text-right font-medium">Passed</th>
                        <th className="px-3 py-2 text-right font-medium">Win rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_partner.map(p => {
                        const decided = p.won + p.lost
                        const winRate = decided > 0 ? `${Math.round((p.won / decided) * 100)}%` : '—'
                        return (
                          <tr key={p.partner_id} className="border-t">
                            <td className="px-3 py-2">{p.partner_name ?? <span className="font-mono text-xs text-muted-foreground">{p.partner_id.slice(0, 8)}</span>}</td>
                            <td className="px-3 py-2 text-right">{p.total}</td>
                            <td className="px-3 py-2 text-right">{p.active}</td>
                            <td className="px-3 py-2 text-right">{p.won}</td>
                            <td className="px-3 py-2 text-right">{p.lost}</td>
                            <td className="px-3 py-2 text-right">{p.passed}</td>
                            <td className="px-3 py-2 text-right font-medium">{winRate}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

function Funnel({ funnel }: { funnel: Analytics['funnel'] }) {
  const steps: Array<{ label: string; value: number }> = [
    { label: 'Created', value: funnel.created },
    { label: 'Ingestion done', value: funnel.has_ingestion },
    { label: 'Research done', value: funnel.has_research },
    { label: 'Q&A captured', value: funnel.has_qa },
    { label: 'Draft assembled', value: funnel.has_memo_draft },
    { label: 'Finalized', value: funnel.finalized },
    { label: 'Won', value: funnel.won },
  ]
  const max = Math.max(...steps.map(s => s.value), 1)

  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => {
        const prev = i === 0 ? null : steps[i - 1].value
        const dropoff = prev && prev > 0 && s.value < prev ? Math.round(((prev - s.value) / prev) * 100) : null
        const pct = (s.value / max) * 100
        return (
          <div key={s.label} className="flex items-center gap-2 text-sm">
            <span className="w-32 shrink-0 text-muted-foreground">{s.label}</span>
            <div className="flex-1 bg-muted rounded h-5 relative overflow-hidden">
              <div className="bg-primary/70 h-full transition-all" style={{ width: `${pct}%` }} />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-medium text-foreground">{s.value}</span>
            </div>
            <span className="w-12 shrink-0 text-right text-xs">
              {dropoff !== null ? <span className="text-amber-600">−{dropoff}%</span> : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}
