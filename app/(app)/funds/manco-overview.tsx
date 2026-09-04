'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'
import { useAccess } from '@/components/access-context'

// THE MANAGEMENT COMPANIES, under the performance table on the Entities landing.
//
// A second table rather than more rows in the first one, because the first one's columns are the
// question "how is this investment doing" — committed, called, distributed, NAV, DPI, TVPI, IRR —
// and a management company has an answer to none of them. It has no commitments, no NAV and no
// partners, so as a row up there it is nine dashes and a name, which reads as a fund whose numbers
// failed to load rather than an entity those numbers do not apply to.
//
// What a firm actually asks about its own operating entity is: how much cash is there, is it
// making or losing money, and how long does the cash last. Those are the columns here. The
// per-entity detail behind them is the entity's lead page, which is where a row leads.
//
// Rendered by the landing page under <FundOverview />, and renders NOTHING at all — no heading,
// no empty state — for a firm that has no management company, or a caller without the grant. An
// empty section explaining an entity kind you do not use is noise on the page you see most.

interface Manco {
  id: string
  name: string
  active: boolean
  chartSeeded: boolean
}

/** The slice of /api/manco/overview this table shows; the lead page reads the rest. */
interface Figures {
  cash: number
  revenue: number
  expenses: number
  net: number
  runwayMonths: number | null
  hasLedger: boolean
}

export function MancoOverview() {
  const currency = useCurrency()
  const fmtFull = (v: number) => formatCurrencyFull(v, currency)
  const access = useAccess()
  const canSee = access('management_company') !== 'none'

  const [mancos, setMancos] = useState<Manco[] | null>(null)
  const [figures, setFigures] = useState<Record<string, Figures | null>>({})

  const load = useCallback(async () => {
    if (!canSee) { setMancos([]); return }
    const r = await fetch('/api/manco/vehicles').catch(() => null)
    if (!r || !r.ok) { setMancos([]); return }
    const rows = await r.json().catch(() => [])
    const list: Manco[] = (Array.isArray(rows) ? rows : [])
      .filter((m: any) => m?.id && m?.name)
      .map((m: any) => ({ id: m.id, name: m.name, active: m.active !== false, chartSeeded: !!m.chartSeeded }))
    setMancos(list)

    // One overview each. A firm has one management entity, occasionally three — the same
    // list-then-fetch-each shape the intercompany card on Admin uses. An entity with no chart
    // yet is skipped: there is nothing to total, and its row says so instead.
    //
    // The window is asked for explicitly. The route's default is the trailing eight quarters,
    // which is the right span for the CHART on the lead page and the wrong one for a single
    // figure here — "revenue" in a summary column means the year, not two of them. Cash ignores
    // the window either way: a balance is as of a date, and that date is today.
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const end = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const win = `start=${now.getFullYear()}-01-01&end=${end}`
    const entries = await Promise.all(list.filter(m => m.chartSeeded).map(async m => {
      const fr = await fetch(`/api/manco/overview?group=${encodeURIComponent(m.name)}&${win}`).catch(() => null)
      const d = fr && fr.ok ? await fr.json().catch(() => null) : null
      return [m.id, d ? {
        cash: d.cash ?? 0,
        revenue: d.revenue ?? 0,
        expenses: d.expenses ?? 0,
        net: d.net ?? 0,
        runwayMonths: d.runwayMonths ?? null,
        hasLedger: !!d.hasLedger,
      } : null] as const
    }))
    setFigures(Object.fromEntries(entries))
  }, [canSee])
  useEffect(() => { load() }, [load])

  if (!canSee || mancos === null || mancos.length === 0) return null

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-medium">Management companies</h2>
        <p className="text-xs text-muted-foreground">
          The firm&rsquo;s own operating entities. They hold no investments, so they carry no NAV or
          multiple &mdash; cash, what they earn against what they spend, and how long the cash lasts.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Entity</th>
              <th className="text-right px-3 py-2 font-medium">Cash</th>
              <th className="text-right px-3 py-2 font-medium">
                Revenue<div className="text-[10px] font-normal">year to date</div>
              </th>
              <th className="text-right px-3 py-2 font-medium">
                Expenses<div className="text-[10px] font-normal">year to date</div>
              </th>
              <th className="text-right px-3 py-2 font-medium">
                Operating result<div className="text-[10px] font-normal">year to date</div>
              </th>
              <th className="text-right px-3 py-2 font-medium">Runway</th>
            </tr>
          </thead>
          <tbody>
            {mancos.map(m => {
              const f = figures[m.id]
              const loading = m.chartSeeded && !(m.id in figures)
              return (
                <tr key={m.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/funds/${m.id}`} className="hover:underline">{m.name}</Link>
                    {!m.active && (
                      <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-caption font-normal text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </td>
                  {!m.chartSeeded ? (
                    <td className="px-3 py-2 text-muted-foreground" colSpan={5}>
                      No chart of accounts yet &mdash;{' '}
                      <Link href="/funds/status" className="hover:underline text-foreground">set up its books</Link> to
                      start keeping them.
                    </td>
                  ) : loading ? (
                    <td className="px-3 py-2 text-muted-foreground" colSpan={5}>
                      <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
                    </td>
                  ) : !f ? (
                    <td className="px-3 py-2 text-muted-foreground" colSpan={5}>Could not load its books.</td>
                  ) : !f.hasLedger ? (
                    <td className="px-3 py-2 text-muted-foreground" colSpan={5}>
                      No entries yet. Import its history or post an entry and this fills in.
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtFull(f.cash)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtFull(f.revenue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtFull(f.expenses)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtFull(f.net)}</td>
                      {/* Null runway is not "unknown": it is not burning cash, which is the good
                          case and should not read as missing data. */}
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {f.runwayMonths == null ? 'Not burning' : `${f.runwayMonths} mo`}
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Revenue and expenses are this year to date, the current month included and whether or not
        the period is closed &mdash; a firm looking at its own operating entity wants the month it
        is in. Cash is the balance today. Runway is cash over the monthly cash burn, so the non-cash
        expenses are left out of it.
      </p>
    </section>
  )
}
