'use client'

// The LPs page — the LIVE cross-vehicle aggregate, and the working surface for LP reporting.
//
// It rolls every LP up to the investor, live, as of any date, and carries the report toolset
// that used to live only on a frozen snapshot: search, per-vehicle filtering, Excel export,
// report-card printing, per-investor rename / grouping / individual cards, notes, the AI
// analyst, and a report header/footer. Sharing freezes a snapshot first (the portal is
// document-based), then shares that.

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, ChevronRight, ChevronDown, Calendar, Search, X, Download, FileText, Settings, Pencil, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'
import { useConfirm } from '@/components/confirm-dialog'
import { useFeatureVisibility, useIsAdmin } from '@/components/feature-visibility-context'
import { PortfolioGroupFilter } from '@/components/lp-portfolio-group-filter'
import { LpSharePanel } from '@/components/lp-share-control'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'
import { PortfolioNotesProvider, PortfolioNotesButton, PortfolioNotesPanel } from '@/components/portfolio-notes'

interface LiveRow {
  entity_id: string
  entity_name: string
  investor_id: string
  investor_name: string
  portfolio_group: string
  source: 'ledger' | 'events'
  lookThroughVia?: string
  commitment: number
  called_capital: number
  paid_in_capital: number
  distributions: number
  nav: number
  total_value: number
  outstanding_balance: number
  dpi: number | null
  rvpi: number | null
  tvpi: number | null
  irr: number | null
}
interface Payload {
  asOf: string | null
  rows: LiveRow[]
}
interface InvestorMeta { id: string; name: string; parent_id: string | null }

interface Totals {
  commitment: number; paid_in_capital: number; distributions: number; nav: number
  total_value: number; outstanding_balance: number
  pctFunded: number | null; dpi: number | null; rvpi: number | null; tvpi: number | null; irr: number | null
}

const moicX = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(2)}x`)
const pctX = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

function total(rows: LiveRow[]): Totals {
  const t = rows.reduce((a, r) => ({
    commitment: a.commitment + r.commitment, paid_in_capital: a.paid_in_capital + r.paid_in_capital,
    distributions: a.distributions + r.distributions, nav: a.nav + r.nav,
    total_value: a.total_value + r.total_value, outstanding_balance: a.outstanding_balance + r.outstanding_balance,
  }), { commitment: 0, paid_in_capital: 0, distributions: 0, nav: 0, total_value: 0, outstanding_balance: 0 })
  const paid = t.paid_in_capital
  return {
    ...t,
    pctFunded: t.commitment > 0 ? t.paid_in_capital / t.commitment : null,
    dpi: paid > 0 ? Math.round((t.distributions / paid) * 10000) / 10000 : null,
    rvpi: paid > 0 ? Math.round((t.nav / paid) * 10000) / 10000 : null,
    tvpi: paid > 0 ? Math.round(((t.distributions + t.nav) / paid) * 10000) / 10000 : null,
    // IRR is not additive across vehicles, so it is only shown when an investor has a single
    // vehicle position (then it is exactly that row's IRR). Multi-vehicle investors show "—".
    irr: rows.length === 1 ? rows[0].irr : null,
  }
}

export default function LpsPage() {
  return (
    <PortfolioNotesProvider pageContext="lps">
      <LpsInner />
    </PortfolioNotesProvider>
  )
}

function LpsInner() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyFull(v, currency)
  const isAdmin = useIsAdmin()
  const fv = useFeatureVisibility()
  const confirm = useConfirm()

  const [asOf, setAsOf] = useState('')
  const [applied, setApplied] = useState('')
  const [data, setData] = useState<Payload | null>(null)
  const [meta, setMeta] = useState<InvestorMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [search, setSearch] = useState('')
  const [excludedGroups, setExcludedGroups] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null)
  const [grouping, setGrouping] = useState<{ id: string; name: string } | null>(null)
  const [shareSnapshotId, setShareSnapshotId] = useState<string | null>(null)
  const [freezing, setFreezing] = useState(false)

  const load = useCallback(async (date: string) => {
    setLoading(true); setError(null)
    try {
      const [repRes, invRes] = await Promise.all([
        fetch(`/api/lps/live-report${date ? `?asOf=${date}` : ''}`),
        fetch('/api/lps/investors'),
      ])
      const rep = await repRes.json()
      if (!repRes.ok) throw new Error(rep.error || 'Failed to build the report')
      setData(rep)
      if (invRes.ok) {
        const inv = await invRes.json()
        setMeta((Array.isArray(inv) ? inv : inv.investors ?? []).map((i: any) => ({ id: i.id, name: i.name, parent_id: i.parent_id ?? null })))
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load(applied) }, [load, applied])

  const allGroups = useMemo(
    () => Array.from(new Set((data?.rows ?? []).map(r => r.portfolio_group))).sort(),
    [data],
  )

  // Rows after the vehicle filter.
  const visibleRows = useMemo(
    () => (data?.rows ?? []).filter(r => !excludedGroups.has(r.portfolio_group)),
    [data, excludedGroups],
  )

  // Roll up to the investor, honoring parent grouping: a child investor's rows fold into its
  // parent so a family/institution shows as one line. Then apply the search.
  const parentOf = useMemo(() => new Map(meta.map(m => [m.id, m.parent_id])), [meta])
  const nameOf = useMemo(() => new Map(meta.map(m => [m.id, m.name])), [meta])

  const investors = useMemo(() => {
    const roll = (id: string) => { // resolve to the topmost parent
      let cur = id, guard = 0
      while (parentOf.get(cur) && guard++ < 20) cur = parentOf.get(cur)!
      return cur
    }
    const byInvestor = new Map<string, { id: string; name: string; rows: LiveRow[] }>()
    for (const r of visibleRows) {
      const top = roll(r.investor_id)
      const cur = byInvestor.get(top) ?? { id: top, name: nameOf.get(top) ?? r.investor_name, rows: [] }
      cur.rows.push(r)
      byInvestor.set(top, cur)
    }
    let list = Array.from(byInvestor.values()).map(i => ({ ...i, totals: total(i.rows) }))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(i => i.name.toLowerCase().includes(q) || i.rows.some(r => r.entity_name.toLowerCase().includes(q)))
    }
    return list.sort((a, b) => b.totals.commitment - a.totals.commitment || a.name.localeCompare(b.name))
  }, [visibleRows, parentOf, nameOf, search])

  const grand = useMemo(() => total(visibleRows), [visibleRows])

  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function exportExcel() {
    setExporting(true)
    try {
      const res = await fetch('/api/lps/export/excel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ live: true, asOfDate: applied || undefined }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `LP Report${applied ? ` ${applied}` : ''}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } finally { setExporting(false) }
  }

  async function shareWithLps() {
    // Freeze the current live report into a snapshot, then share THAT — the portal shares
    // fixed statements, not a live view.
    setFreezing(true); setError(null)
    try {
      const res = await fetch('/api/lps/snapshots/from-live', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asOfDate: applied || undefined }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.snapshotId) { setError(d.error ?? 'Could not prepare the report to share.'); return }
      setShareSnapshotId(d.snapshotId)
    } catch {
      setError('Could not prepare the report to share.')
    } finally {
      setFreezing(false)
    }
  }

  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full space-y-6">
      {/* Row 1 — title, notes, analyst. */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">LPs</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Every LP&rsquo;s capital across every vehicle, derived live rather than from a stored snapshot —
            rebuild it as of any date.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <PortfolioNotesButton />
          <AnalystToggleButton />
        </div>
      </div>

      {/* Row 2 — search, filter, as-of, actions. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search investors..."
            className="w-40 md:w-56 border border-input rounded pl-7 pr-6 py-1.5 text-sm bg-transparent placeholder:text-muted-foreground"
          />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>}
        </div>
        {allGroups.length > 1 && (
          <PortfolioGroupFilter
            allGroups={allGroups}
            excludedGroups={excludedGroups}
            onToggle={g => setExcludedGroups(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n })}
            onToggleAll={() => setExcludedGroups(prev => prev.size === 0 ? new Set(allGroups) : new Set())}
          />
        )}
        <label className="text-xs text-muted-foreground flex items-center gap-1 ml-1"><Calendar className="h-3 w-3" /> As of</label>
        {/* Changing the date rebuilds immediately — no separate apply button. Default (empty)
            is the latest data; "Latest" resets back to it. */}
        <Input type="date" value={asOf} onChange={e => { setAsOf(e.target.value); setApplied(e.target.value) }} className="h-9 w-40" />
        {applied && <Button size="sm" variant="ghost" onClick={() => { setAsOf(''); setApplied('') }}>Latest</Button>}

        <span className="flex-1" />

        <Button size="sm" variant="outline" className="text-muted-foreground" onClick={exportExcel} disabled={exporting || investors.length === 0}>
          <Download className="h-4 w-4 mr-1" />{exporting ? 'Exporting…' : 'Export Excel'}
        </Button>
        <Button size="sm" variant="outline" className="text-muted-foreground" asChild>
          <Link href="/lps/cards"><FileText className="h-4 w-4 mr-1" /> Report cards</Link>
        </Button>
        {isAdmin && (
          <Button size="sm" variant="outline" className="text-muted-foreground" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4 mr-1" /> Settings
          </Button>
        )}
        {isAdmin && (fv.lp_portal_access === 'everyone' || fv.lp_portal_access === 'admin') && (
          <Button size="sm" variant="outline" className="text-muted-foreground" onClick={shareWithLps} disabled={freezing || investors.length === 0}>
            {freezing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Users className="h-4 w-4 mr-1" />} Share with LPs
          </Button>
        )}
      </div>

      {error && <Card><CardContent className="p-4 text-red-600 text-sm">{error}</CardContent></Card>}

      {loading && !data ? (
        <div className="flex items-center py-16 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Deriving from the ledger…</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Stat label="Commitment" value={fmt(grand.commitment)} />
            <Stat label="Paid in" value={fmt(grand.paid_in_capital)} />
            <Stat label="Distributions" value={fmt(grand.distributions)} />
            <Stat label="NAV" value={fmt(grand.nav)} />
            <Stat label="TVPI" value={grand.tvpi != null ? `${grand.tvpi.toFixed(2)}x` : '—'} />
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left font-medium px-3 py-2">Investor</th>
                    <th className="text-right font-medium px-3 py-2">Commitment</th>
                    <th className="text-right font-medium px-3 py-2">Paid in</th>
                    <th className="text-right font-medium px-3 py-2">Unfunded</th>
                    <th className="text-right font-medium px-3 py-2">% Funded</th>
                    <th className="text-right font-medium px-3 py-2">Distributions</th>
                    <th className="text-right font-medium px-3 py-2">NAV</th>
                    <th className="text-right font-medium px-3 py-2">DPI</th>
                    <th className="text-right font-medium px-3 py-2">RVPI</th>
                    <th className="text-right font-medium px-3 py-2">TVPI</th>
                    <th className="text-right font-medium px-3 py-2">IRR</th>
                    {isAdmin && <th className="px-3 py-2 w-0" />}
                  </tr>
                </thead>
                <tbody>
                  {investors.map(inv => {
                    const open = expanded.has(inv.id)
                    const multi = inv.rows.length > 1
                    return (
                      <Fragment key={inv.id}>
                        <tr className={`border-b group ${multi ? 'cursor-pointer hover:bg-muted/20' : 'hover:bg-muted/10'}`} onClick={() => multi && toggle(inv.id)}>
                          <td className="px-3 py-1.5 font-medium">
                            <span className="flex items-center gap-1">
                              {multi ? (open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />) : <span className="w-3.5 shrink-0" />}
                              {/* Long names truncate at a fixed cap rather than wrapping or collapsing the column. */}
                              <span className="truncate max-w-[240px]" title={inv.name}>{inv.name}</span>
                              {multi && <span className="text-xs text-muted-foreground font-normal ml-1 shrink-0">({inv.rows.length})</span>}
                            </span>
                          </td>
                          <Money v={inv.totals.commitment} fmt={fmt} />
                          <Money v={inv.totals.paid_in_capital} fmt={fmt} />
                          <Money v={inv.totals.outstanding_balance} fmt={fmt} />
                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{pctX(inv.totals.pctFunded)}</td>
                          <Money v={inv.totals.distributions} fmt={fmt} />
                          <Money v={inv.totals.nav} fmt={fmt} />
                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{moicX(inv.totals.dpi)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{moicX(inv.totals.rvpi)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{moicX(inv.totals.tvpi)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{pctX(inv.totals.irr)}</td>
                          {isAdmin && (
                            <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground" onClick={e => e.stopPropagation()}>
                              <span className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Link href={`/lps/cards/${inv.id}`} title="Report card" className="hover:text-foreground"><FileText className="h-3.5 w-3.5" /></Link>
                                <button onClick={() => setRename({ id: inv.id, name: inv.name })} title="Rename" className="hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                                <button onClick={() => setGrouping({ id: inv.id, name: inv.name })} title="Group under another investor" className="hover:text-foreground"><Users className="h-3.5 w-3.5" /></button>
                              </span>
                            </td>
                          )}
                        </tr>
                        {open && inv.rows.map(r => (
                          <tr key={`${inv.id}-${r.entity_id}-${r.portfolio_group}`} className="border-b bg-muted/10 text-muted-foreground">
                            <td className="px-3 py-1.5 pl-10 text-xs">
                              <span className="truncate block max-w-[320px]" title={`${r.portfolio_group}${r.entity_name !== inv.name ? ` · ${r.entity_name}` : ''}`}>
                                {r.portfolio_group}
                                {r.entity_name !== inv.name && <span className="ml-1">· {r.entity_name}</span>}
                                {r.lookThroughVia && <Badge variant="secondary" className="ml-1 text-[10px] py-0 px-1">via {r.lookThroughVia}</Badge>}
                              </span>
                            </td>
                            <Money v={r.commitment} fmt={fmt} small />
                            <Money v={r.paid_in_capital} fmt={fmt} small />
                            <Money v={r.outstanding_balance} fmt={fmt} small />
                            <td className="px-3 py-1.5 text-right tabular-nums text-xs">{pctX(r.commitment > 0 ? r.paid_in_capital / r.commitment : null)}</td>
                            <Money v={r.distributions} fmt={fmt} small />
                            <Money v={r.nav} fmt={fmt} small />
                            <td className="px-3 py-1.5 text-right tabular-nums text-xs">{moicX(r.dpi)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-xs">{moicX(r.rvpi)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-xs">{moicX(r.tvpi)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-xs">{pctX(r.irr)}</td>
                            {isAdmin && <td />}
                          </tr>
                        ))}
                      </Fragment>
                    )
                  })}
                  {investors.length === 0 && (
                    <tr><td colSpan={isAdmin ? 12 : 11} className="p-8 text-center text-muted-foreground">
                      {search ? 'No investors match your search.' : 'No LP capital found. Track a vehicle’s positions or book its history.'}
                    </td></tr>
                  )}
                </tbody>
                {investors.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 font-medium bg-muted/30">
                      <td className="px-3 py-1.5">Total</td>
                      <Money v={grand.commitment} fmt={fmt} />
                      <Money v={grand.paid_in_capital} fmt={fmt} />
                      <Money v={grand.outstanding_balance} fmt={fmt} />
                      <td className="px-3 py-1.5 text-right tabular-nums">{pctX(grand.pctFunded)}</td>
                      <Money v={grand.distributions} fmt={fmt} />
                      <Money v={grand.nav} fmt={fmt} />
                      <td className="px-3 py-1.5 text-right tabular-nums">{moicX(grand.dpi)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{moicX(grand.rvpi)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{moicX(grand.tvpi)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{grand.irr != null ? pctX(grand.irr) : '—'}</td>
                      {isAdmin && <td />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}

      {settingsOpen && <ReportSettingsDialog onClose={() => setSettingsOpen(false)} />}
      {rename && <RenameDialog investor={rename} allInvestors={investors.map(i => ({ id: i.id, name: i.name }))} onClose={() => setRename(null)} onSaved={() => { setRename(null); load(applied) }} />}
      {grouping && <GroupDialog investor={grouping} candidates={investors.map(i => ({ id: i.id, name: i.name }))} onClose={() => setGrouping(null)} onSaved={() => { setGrouping(null); load(applied) }} />}

      {/* Share freezes the current live report into a fixed snapshot, then lets you pick which
          LPs can see it in their portal — the same picker the capital-accounts publish uses.
          No email is sent; LPs see it when they sign in. */}
      <Dialog open={!!shareSnapshotId} onOpenChange={o => { if (!o) setShareSnapshotId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share this report with LPs</DialogTitle>
            <DialogDescription>
              A snapshot was frozen from the current live data ({applied || 'latest'}), so LPs see a fixed statement
              rather than a moving view. Check the LPs who should see it in their portal.
            </DialogDescription>
          </DialogHeader>
          {shareSnapshotId && (
            <>
              <LpSharePanel shareEndpoint={`/api/lps/snapshots/${shareSnapshotId}/share`} />
              <div className="flex justify-end pt-1">
                <Button variant="ghost" size="sm" asChild><Link href="/lps/snapshots">Open in archive</Link></Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <PortfolioNotesPanel />
      <AnalystPanel />
    </div>
  )
}

function Money({ v, fmt, small }: { v: number; fmt: (n: number) => string; small?: boolean }) {
  return <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${small ? 'text-xs' : ''}`}>{fmt(v)}</td>
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="pt-4 pb-3 px-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </CardContent></Card>
  )
}

// ---------------------------------------------------------------------------
// Dialogs — report settings (fund-level header/footer), rename, group.
// ---------------------------------------------------------------------------

function ReportSettingsDialog({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState('')
  const [footer, setFooter] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/lps/live-settings').then(r => r.json()).then(d => { setDescription(d.description ?? ''); setFooter(d.footer ?? ''); setLoaded(true) })
  }, [])

  async function save() {
    setSaving(true)
    await fetch('/api/lps/live-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description, footer }) })
    setSaving(false); onClose()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report settings</DialogTitle>
          <DialogDescription>The header paragraph and footer note printed on every live report card.</DialogDescription>
        </DialogHeader>
        {!loaded ? <div className="py-8 flex justify-center"><Loader2 className="h-4 w-4 animate-spin" /></div> : (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Header paragraph</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4}
                placeholder="A short introduction shown at the top of every investor report."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Footer note</label>
              <textarea value={footer} onChange={e => setFooter(e.target.value)} rows={3}
                placeholder="Leave blank for the default metric definitions."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !loaded}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RenameDialog({ investor, allInvestors, onClose, onSaved }: { investor: { id: string; name: string }; allInvestors: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(investor.name)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Renaming to a name that already exists is how you consolidate the same LP that came in
  // slightly misnamed across different vehicles: instead of erroring on the duplicate, we merge
  // this investor into the existing one (reassign its entities, delete this row).
  const match = allInvestors.find(i => i.id !== investor.id && i.name.trim().toLowerCase() === name.trim().toLowerCase())

  async function save() {
    if (!name.trim()) return
    setSaving(true); setErr(null)
    const res = match
      ? await fetch('/api/lps/investors', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: investor.id, targetId: match.id }) })
      : await fetch('/api/lps/investors', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: investor.id, name: name.trim() }) })
    setSaving(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error === 'duplicate_name' ? 'An investor with that name already exists.' : (d.error ?? 'Could not rename')); return }
    onSaved()
  }
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Rename investor</DialogTitle></DialogHeader>
        <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} autoFocus />
        {match && <p className="text-xs text-muted-foreground">&ldquo;{match.name}&rdquo; already exists — saving will <strong>merge</strong> this investor into it, combining their positions across vehicles.</p>}
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving…' : match ? 'Merge' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GroupDialog({ investor, candidates, onClose, onSaved }: {
  investor: { id: string; name: string }
  candidates: { id: string; name: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [parentId, setParentId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const options = candidates.filter(c => c.id !== investor.id)

  async function save(id: string | null) {
    setSaving(true)
    await fetch('/api/lps/investors', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: investor.id, parentId: id }) })
    setSaving(false); onSaved()
  }
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Group &ldquo;{investor.name}&rdquo;</DialogTitle>
          <DialogDescription>Roll this investor&rsquo;s positions up under another investor on the report.</DialogDescription>
        </DialogHeader>
        <select value={parentId} onChange={e => setParentId(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm">
          <option value="">Choose an investor…</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => save(null)} disabled={saving}>Ungroup</Button>
          <span className="flex-1" />
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save(parentId || null)} disabled={saving || !parentId}>{saving ? 'Saving…' : 'Group'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
