import { Building2, Crown, FileText, Lightbulb, StickyNote } from 'lucide-react'
import type { DemoCompany, DemoMetric, DemoSnapshot } from './types'

/**
 * The screens behind the palette's destinations. They are the widget's own rendering of the
 * snapshot, kept to what the search and the Analyst need for context: enough of the portfolio
 * and a company to make a question worth asking. They are not the product's pages, and say so
 * where the product has one the demo does not.
 */

const nf = (v: number, unit: string | null, pos: string, type: string): string => {
  if (type === 'percentage') return `${trim(v)}%`
  const abs = Math.abs(v)
  const compact = abs >= 1e9 ? `${trim(v / 1e9)}B` : abs >= 1e6 ? `${trim(v / 1e6)}M` : abs >= 1e3 ? `${trim(v / 1e3)}K` : trim(v)
  if (!unit) return compact
  return pos === 'suffix' ? `${compact}${unit}` : `${unit}${compact}`
}
const trim = (v: number) => (Math.round(v * 10) / 10).toString().replace(/\.0$/, '')

function latest(m: DemoMetric) {
  const vals = m.values.filter(v => v.number != null)
  return vals[vals.length - 1] ?? null
}

/** A hairline sparkline in the direction the metric moved. */
function Sparkline({ metric }: { metric: DemoMetric }) {
  const pts = metric.values.map(v => v.number).filter((n): n is number => n != null)
  if (pts.length < 2) return <span className="inline-block h-4 w-24" />
  const min = Math.min(...pts), max = Math.max(...pts)
  const w = 96, h = 16
  const d = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * w
    const y = max === min ? h / 2 : h - ((p - min) / (max - min)) * (h - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const up = pts[pts.length - 1] >= pts[0]
  // Cash and burn read the other way round: falling cash is the worry, rising burn too.
  const good = metric.slug === 'cash' ? up : metric.slug === 'burn' || metric.slug === 'churn' ? !up : up
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={good ? 'text-success' : 'text-destructive'} aria-hidden>
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-sm border px-1.5 py-px text-[11px] text-muted-foreground">{children}</span>
}

export function PortfolioScreen({ snapshot, onOpen }: { snapshot: DemoSnapshot; onOpen: (href: string) => void }) {
  const groups = new Map<string, DemoCompany[]>()
  for (const c of snapshot.companies) {
    const g = c.portfolio_group?.[0] ?? 'Portfolio'
    groups.set(g, [...(groups.get(g) ?? []), c])
  }
  const order = [...groups.keys()].sort().reverse()
  return (
    <div>
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-sm text-muted-foreground">Track performance and activity across your portfolio companies</p>
        </div>
        <Chip>{snapshot.companies.length} active</Chip>
      </div>
      {order.map(g => (
        <section key={g} className="mb-6">
          <h2 className="mb-2 text-sm text-muted-foreground">{g}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {groups.get(g)!.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpen(`/companies/${c.id}`)}
                className="rounded-card border bg-card p-4 text-left transition-colors hover:border-foreground/40"
              >
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{c.name}</span>
                  {c.stage && <Chip>{c.stage}</Chip>}
                  {c.industry?.[0] && <Chip>{c.industry[0]}</Chip>}
                </div>
                <div className="mb-3 text-xs text-muted-foreground">{c.metrics.length} metrics</div>
                <div className="space-y-2">
                  {c.metrics.slice(0, 2).map(m => {
                    const v = latest(m)
                    return (
                      <div key={m.id} className="flex items-center gap-2 text-xs">
                        <span className="w-24 truncate text-muted-foreground">{m.name}</span>
                        <Sparkline metric={m} />
                        <span className="ml-auto font-medium tabular-nums">{v?.number != null ? nf(v.number, m.unit, m.unit_position, m.value_type) : '—'}</span>
                      </div>
                    )
                  })}
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function CompanyScreen({ snapshot, company }: { snapshot: DemoSnapshot; company: DemoCompany }) {
  const notes = snapshot.notes.filter(n => n.company_id === company.id)
  const interactions = snapshot.interactions.filter(i => i.company_id === company.id)
  const invested = snapshot.investments.filter(i => i.company_id === company.id && i.type === 'investment').reduce((s, i) => s + (i.cost ?? 0), 0)
  const gain = snapshot.investments.filter(i => i.company_id === company.id && i.type === 'unrealized_gain_change').reduce((s, i) => s + (i.unrealized_change ?? 0), 0)
  return (
    <div>
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{company.name}</h1>
          {company.stage && <Chip>{company.stage}</Chip>}
          {company.industry?.map(i => <Chip key={i}>{i}</Chip>)}
          {company.portfolio_group?.map(g => <Chip key={g}>{g}</Chip>)}
        </div>
        {company.overview && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{company.overview}</p>}
        {company.founders && <p className="mt-1 text-xs text-muted-foreground">Founders: {company.founders}</p>}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-card border bg-card p-4">
          <div className="text-xs text-muted-foreground">Invested</div>
          <div className="text-lg font-semibold tabular-nums">{nf(invested, '$', 'prefix', 'currency')}</div>
        </div>
        <div className="rounded-card border bg-card p-4">
          <div className="text-xs text-muted-foreground">Unrealized gain</div>
          <div className="text-lg font-semibold tabular-nums">{gain ? `+${nf(gain, '$', 'prefix', 'currency')}` : 'Held at cost'}</div>
        </div>
        <div className="rounded-card border bg-card p-4">
          <div className="text-xs text-muted-foreground">Why we invested</div>
          <div className="text-sm">{company.why_invested ?? '—'}</div>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-medium">Metrics</h2>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {company.metrics.map(m => {
          const vals = m.values.filter(v => v.number != null)
          const last = vals[vals.length - 1]
          const first = vals[0]
          return (
            <div key={m.id} className="rounded-card border bg-card p-4">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-medium">{m.name}</div>
                <div className="text-xs text-muted-foreground">{m.cadence}</div>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <div className="text-lg font-semibold tabular-nums">{last?.number != null ? nf(last.number, m.unit, m.unit_position, m.value_type) : '—'}</div>
                <Sparkline metric={m} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {first && last && first !== last ? `${first.period_label} → ${last.period_label}` : last?.period_label}
              </div>
            </div>
          )
        })}
      </div>

      {(notes.length > 0 || interactions.length > 0) && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {notes.length > 0 && (
            <div className="rounded-card border bg-card p-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium"><StickyNote className="h-3.5 w-3.5" />Notes</h2>
              <ul className="space-y-2 text-sm">
                {notes.map(n => <li key={n.id} className="text-muted-foreground">{n.content}</li>)}
              </ul>
            </div>
          )}
          {interactions.length > 0 && (
            <div className="rounded-card border bg-card p-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium"><FileText className="h-3.5 w-3.5" />Interactions</h2>
              <ul className="space-y-2 text-sm">
                {interactions.map((i, k) => (
                  <li key={k}>
                    <div className="font-medium">{i.subject}</div>
                    <div className="text-muted-foreground">{i.summary}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function LpsScreen({ snapshot }: { snapshot: DemoSnapshot }) {
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold tracking-tight">LPs</h1>
      <p className="mb-4 text-sm text-muted-foreground">Investors across {snapshot.vehicles.map(v => v.name).join(' and ')}.</p>
      <ul className="divide-y rounded-card border bg-card">
        {snapshot.lps.map(lp => (
          <li key={lp.id} className="flex items-center gap-2 px-4 py-2.5 text-sm"><Crown className="h-3.5 w-3.5 text-muted-foreground" />{lp.name}</li>
        ))}
      </ul>
    </div>
  )
}

export function DealsScreen({ snapshot }: { snapshot: DemoSnapshot }) {
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Deals</h1>
      <p className="mb-4 text-sm text-muted-foreground">Inbound pitches, classified and scored against the fund&apos;s thesis.</p>
      <div className="space-y-3">
        {snapshot.deals.map(d => (
          <div key={d.id} className="rounded-card border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{d.company_name}</span>
              {d.stage && <Chip>{d.stage}</Chip>}
              {d.status && <Chip>{d.status.replace(/_/g, ' ')}</Chip>}
              {d.thesis_fit_score && <Chip>fit: {d.thesis_fit_score.replace(/_/g, ' ')}</Chip>}
              {d.raise_amount && <span className="ml-auto text-xs text-muted-foreground">{d.raise_amount}</span>}
            </div>
            {d.company_summary && <p className="mt-2 text-sm text-muted-foreground">{d.company_summary}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

export function NotesScreen({ snapshot }: { snapshot: DemoSnapshot }) {
  const name = (id: string | null) => snapshot.companies.find(c => c.id === id)?.name ?? 'Fund'
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Notes</h1>
      <p className="mb-4 text-sm text-muted-foreground">What the team has written down, across the fund and its companies.</p>
      <ul className="divide-y rounded-card border bg-card">
        {snapshot.notes.map(n => (
          <li key={n.id} className="px-4 py-3 text-sm">
            <div className="mb-0.5 text-xs text-muted-foreground">{name(n.company_id)} · {n.created_at}</div>
            {n.content}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PlaceholderScreen({ href }: { href: string }) {
  const label = href.split('/').filter(Boolean).map(s => decodeURIComponent(s)).filter(s => !/^[0-9a-f-]{20,}$/i.test(s)).join(' / ') || 'Home'
  return (
    <div className="rounded-card border border-dashed p-8 text-center">
      <Building2 className="mx-auto mb-3 h-5 w-5 text-muted-foreground" />
      <h1 className="text-base font-medium">{label}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        This page is in the full product. The demo carries the portfolio, its companies, LPs, deals and notes, which is
        what the search and the Analyst work from.
      </p>
    </div>
  )
}
