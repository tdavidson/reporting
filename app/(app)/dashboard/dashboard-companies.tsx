'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ArrowDownAZ, ArrowUpZA, ArrowDown, ArrowUp, LayoutGrid, Table2, CalendarDays, Plus, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DashboardTable } from './dashboard-table'
import { useCurrency, getCurrencySymbol } from '@/components/currency-context'
import { useDisplayUnit } from '@/components/display-unit-context'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CompanyForm } from '@/components/company-form'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

interface ActiveMetric {
  id: string
  name: string
  unit: string | null
  unit_position: string
  value_type: string
  currency: string | null
}

interface Company {
  id: string
  name: string
  stage: string | null
  status: string
  tags: string[]
  industry: string[] | null
  portfolioGroup: string[] | null
  lastReportAt: string | null
  openReviews: number
  activeMetrics: ActiveMetric[]
  latestCash: number | null
  firstInvestmentDate: string | null
  moic: number | null
  grossIrr: number | null
  totalInvested: number | null
  totalRealized: number | null
  unrealizedValue: number | null
  logoUrl: string | null
}

interface Props {
  companies: Company[]
  allGroups: string[]
}

type SortMode = 'alpha' | 'investDate' | null

function formatMetricValue(v: number | null, metric: ActiveMetric, fundCurrency: string): string {
  if (v === null) return '\u2014'
  const metricCurrency = metric.currency ?? fundCurrency
  const effectiveUnit = metric.unit ?? (metric.value_type === 'currency' ? getCurrencySymbol(metricCurrency) : null)
  const effectivePos = metric.unit ? metric.unit_position : 'prefix'
  let str: string
if (Math.abs(v) >= 1_000_000) str = (v / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'M'
else if (Math.abs(v) >= 1_000) str = (v / 1_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'K'
  else str = v.toLocaleString()
  if (effectiveUnit && effectivePos === 'prefix') return `${effectiveUnit}${str}`
  if (metric.value_type === 'percentage') return `${str}%`
  if (effectiveUnit && effectivePos === 'suffix') return `${str} ${effectiveUnit}`
  return str
}

function statusBadge(status: string) {
  if (status === 'exited') return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">Exited</Badge>
  if (status === 'written-off') return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">Written Off</Badge>
  return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Active</Badge>
}

function CompanyAvatar({ company, onLogoUpdate }: { company: Company; onLogoUpdate: (id: string, url: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const initials = company.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`/api/companies/${company.id}/logo`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (res.ok) onLogoUpdate(company.id, data.logo_url)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="relative group w-10 h-10 flex-shrink-0">
      <div
        className="w-10 h-10 rounded-md overflow-hidden bg-muted flex items-center justify-center cursor-pointer"
        onClick={e => { e.preventDefault(); inputRef.current?.click() }}
      >
        {company.logoUrl ? (
          <Image src={company.logoUrl} alt={company.name} width={40} height={40} className="object-cover w-full h-full" />
        ) : (
          <span className="text-xs font-semibold text-muted-foreground">{initials}</span>
        )}
        <div className="absolute inset-0 bg-black/40 rounded-md opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          {uploading ? (
            <span className="text-white text-[10px]">...</span>
          ) : (
            <Upload className="h-3.5 w-3.5 text-white" />
          )}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
    </div>
  )
}

export function DashboardCompanies({ companies, allGroups }: Props) {
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [sortMode, setSortMode] = useState<SortMode>('investDate')
  const [alphaSortAsc, setAlphaSortAsc] = useState(true)
  const [investDateSortAsc, setInvestDateSortAsc] = useState(false)
  const [logoMap, setLogoMap] = useState<Record<string, string>>({})

  function handleLogoUpdate(id: string, url: string) {
    setLogoMap(prev => ({ ...prev, [id]: url }))
  }

  const filtered = useMemo(() => {
    let result = companies
    if (statusFilter) {
      result = result.filter(c => c.status === statusFilter)
    }
    return result
  }, [companies, statusFilter])

  function sortCompanies(list: Company[]) {
    if (sortMode === 'alpha') {
      return [...list].sort((a, b) =>
        alphaSortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      )
    }
    if (sortMode === 'investDate') {
      return [...list].sort((a, b) => {
        const aDate = a.firstInvestmentDate
        const bDate = b.firstInvestmentDate
        if (!aDate && !bDate) return 0
        if (!aDate) return 1
        if (!bDate) return -1
        return investDateSortAsc ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate)
      })
    }
    return list
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sortedFiltered = useMemo(() => sortCompanies(filtered), [filtered, sortMode, alphaSortAsc, investDateSortAsc])

  return (
    <div>
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-xs px-2 py-1 rounded-md border border-border bg-background"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="exited">Exited</option>
              <option value="written-off">Written Off</option>
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <AddCompanyButton />
            <div className="w-px h-4 bg-border" />
            <Button
              variant={sortMode === 'alpha' ? 'secondary' : 'ghost'}
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                if (sortMode === 'alpha') {
                  setAlphaSortAsc(prev => !prev)
                } else {
                  setSortMode('alpha')
                }
              }}
            >
              {alphaSortAsc ? (
                <ArrowDownAZ className="h-3.5 w-3.5" />
              ) : (
                <ArrowUpZA className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant={sortMode === 'investDate' ? 'secondary' : 'ghost'}
              size="sm"
              className="text-xs gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                if (sortMode === 'investDate') {
                  setInvestDateSortAsc(prev => !prev)
                } else {
                  setSortMode('investDate')
                }
              }}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {investDateSortAsc ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
            </Button>
            <Button variant={view === 'cards' ? 'secondary' : 'ghost'} size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => setView('cards')}>
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button variant={view === 'table' ? 'secondary' : 'ghost'} size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => setView('table')}>
              <Table2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center space-y-4">
          <p className="text-muted-foreground">No companies match the selected filters.</p>
          <AddCompanyButton />
        </div>
      ) : view === 'table' ? (
        <DashboardTable
          companyIds={sortedFiltered.map(c => c.id)}
          grouped={null}
        />
      ) : (
        <CompanyGrid companies={sortedFiltered} logoMap={logoMap} onLogoUpdate={handleLogoUpdate} />
      )}
    </div>
  )
}

function CompanyGrid({ companies, logoMap, onLogoUpdate }: { companies: Company[]; logoMap: Record<string, string>; onLogoUpdate: (id: string, url: string) => void }) {
  const fundCurrency = useCurrency()
  const [metricValues, setMetricValues] = useState<Record<string, number | null>>({})
  const [loadingMetrics, setLoadingMetrics] = useState<Set<string>>(new Set())
  const fetchedRef = useRef<Set<string>>(new Set())

const getSelectedMetrics = useCallback((c: Company): [ActiveMetric | null, ActiveMetric | null] => {
  const valuation = c.activeMetrics.find(m =>
    /valuation|post.?money/i.test(m.name) || /valuation|post_money/i.test(m.slug ?? '')
  ) ?? null

  const revenue = c.activeMetrics.find(m =>
    /net revenue|gross revenue|revenue|mrr|arr/i.test(m.name)
  ) ?? null

  return [valuation, revenue]
}, [])


  useEffect(() => {
    const metricsToFetch: { companyId: string; metricId: string }[] = []
    for (const c of companies) {
      if (c.status === 'exited' || c.status === 'written-off') continue
      const [m1, m2] = getSelectedMetrics(c)
      for (const m of [m1, m2]) {
        if (m && !fetchedRef.current.has(m.id)) {
          metricsToFetch.push({ companyId: c.id, metricId: m.id })
          fetchedRef.current.add(m.id)
        }
      }
    }

    if (metricsToFetch.length === 0) return

    setLoadingMetrics(prev => {
      const next = new Set(prev)
      metricsToFetch.forEach(({ metricId }) => next.add(metricId))
      return next
    })

    for (const { companyId, metricId } of metricsToFetch) {
      fetch(`/api/companies/${companyId}/metrics/${metricId}/values`)
        .then(res => res.ok ? res.json() : [])
        .then((values: { value_number: number | null }[]) => {
          const lastVal = values.length > 0 ? values[values.length - 1].value_number : null
          setMetricValues(prev => ({ ...prev, [metricId]: lastVal }))
          setLoadingMetrics(prev => {
            const next = new Set(prev)
            next.delete(metricId)
            return next
          })
        })
        .catch(() => {
          setLoadingMetrics(prev => {
            const next = new Set(prev)
            next.delete(metricId)
            return next
          })
        })
    }
  }, [companies, getSelectedMetrics])

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {companies.map((c) => {
        const isExited = c.status === 'exited' || c.status === 'written-off'
        const logoUrl = logoMap[c.id] ?? c.logoUrl

        return (
          <div key={c.id} className="rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors">
            <div className="flex items-start gap-3 mb-1">
              <CompanyAvatar
                company={{ ...c, logoUrl }}
                onLogoUpdate={onLogoUpdate}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/companies/${c.id}`} className="font-medium text-sm hover:underline truncate">
                    {c.name}
                  </Link>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {statusBadge(c.status)}
                    {c.openReviews > 0 && (
                      <span className="rounded-full bg-amber-500 text-white text-[10px] font-semibold leading-none px-1.5 py-0.5 min-w-[18px] text-center">
                        {c.openReviews}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <Link href={`/companies/${c.id}`} className="block">
              {isExited ? (
                <ExitedMetricDisplay company={c} />
              ) : c.activeMetrics.length === 0 ? (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground truncate mb-0.5">No metrics</div>
                    <div className="text-xl font-semibold">New</div>
                  </div>
                </div>
              ) : (
                <ActiveMetricDisplay
                  company={c}
                  metrics={getSelectedMetrics(c)}
                  metricValues={metricValues}
                  loadingMetrics={loadingMetrics}
                  fundCurrency={fundCurrency}
                />
              )}
              {c.lastReportAt ? (
                <div className="text-[10px] text-muted-foreground mt-2">
                  Last reported: {c.lastReportAt}
                </div>
              ) : c.firstInvestmentDate ? (
                <div className="text-[10px] text-muted-foreground mt-2">
                  Invested: {new Date(c.firstInvestmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              ) : null}
            </Link>
          </div>
        )
      })}
    </div>
  )
}

function ActiveMetricDisplay({ company, metrics, metricValues, loadingMetrics, fundCurrency }: {
  company: Company
  metrics: [ActiveMetric | null, ActiveMetric | null]
  metricValues: Record<string, number | null>
  loadingMetrics: Set<string>
  fundCurrency: string
}) {
  const [m1, m2] = metrics

  return (
    <div className="grid grid-cols-2 gap-3 mt-3">
      {[m1, m2].map((metric, i) => {
        if (!metric) return <div key={i} />
        const isLoading = loadingMetrics.has(metric.id)
        const value = metricValues[metric.id] ?? null
        return (
          <div key={metric.id} className="min-w-0">
            <div className="text-[10px] text-muted-foreground truncate mb-0.5">{metric.name}</div>
            <div className="text-xl font-semibold tabular-nums truncate">
              {isLoading ? (
                <span className="text-muted-foreground text-sm">...</span>
              ) : (
                formatMetricValue(value, metric, fundCurrency)
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ExitedMetricDisplay({ company }: { company: Company }) {
  const currency = useCurrency()
  const { displayUnit } = useDisplayUnit()
  const symbol = currency === 'BRL' ? 'R$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'

function fmtTable(v: number): string {
  const options = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  
  if (displayUnit === 'millions') return `${symbol}${(v / 1_000_000).toLocaleString('en-US', options)}M`
  if (displayUnit === 'thousands') return `${symbol}${(v / 1_000).toLocaleString('en-US', options)}K`
  
  const neg = v < 0
  const abs = Math.abs(v)
  let str: string
  
  if (abs >= 1_000_000) str = `${symbol}${(abs / 1_000_000).toLocaleString('en-US', options)}M`
  else if (abs >= 1_000) str = `${symbol}${(abs / 1_000).toLocaleString('en-US', options)}K`
  else str = `${symbol}${abs.toLocaleString('en-US', options)}`
  
  return neg ? `-${str}` : str
}

  const { totalInvested, totalRealized, unrealizedValue, moic } = company
  const netGain = totalInvested != null && totalRealized != null && unrealizedValue != null
    ? (totalRealized + unrealizedValue) - totalInvested
    : null

  return (
    <div className="grid grid-cols-2 gap-3 mt-3">
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground truncate mb-0.5">Net Gain</div>
        <div className={`text-xl font-semibold tabular-nums truncate ${netGain != null && netGain < 0 ? 'text-red-500' : ''}`}>
          {netGain != null ? fmtTable(netGain) : '\u2014'}
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground truncate mb-0.5">Gross MOIC</div>
        <div className="text-xl font-semibold tabular-nums truncate">
          {moic != null ? `${moic.toFixed(2)}x` : '\u2014'}
        </div>
      </div>
    </div>
  )
}

function AddCompanyButton() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
<Button size="sm" className="gap-1.5 bg-[#0F2332] hover:bg-[#0F2332]/90 text-white">         
  <Plus className="h-3.5 w-3.5" />
          Add Company
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Company</DialogTitle>
        </DialogHeader>
        <CompanyForm
          onSuccess={() => { setOpen(false); router.refresh() }}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
