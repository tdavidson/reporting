'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Trash2, Save, X, Pencil, Briefcase, Lock, Upload, GripVertical, BarChart2, SlidersHorizontal, FileText, ExternalLink, FilePlus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCurrency, formatCurrency, formatCurrencyFull } from '@/components/currency-context'
import { xirr, type CashFlow } from '@/lib/xirr'
import { useFeatureVisibility } from '@/components/feature-visibility-context'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'
import { PortfolioNotesProvider, PortfolioNotesButton, PortfolioNotesPanel } from '@/components/portfolio-notes'
import { useDisplayUnit, type DisplayUnit } from '@/components/display-unit-context'

interface FundCashFlow {
  id: string
  fund_id: string
  portfolio_group: string
  flow_date: string
  flow_type: 'commitment' | 'called_capital' | 'distribution'
  amount: number
  notes: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

interface FundContractTerms {
  portfolio_group: string
  fund_id: string
  fund_name: string | null
  cnpj: string | null
  gp_name: string | null
  lp_names: string | null
  fund_administrator: string | null
  auditor: string | null
  legal_counsel: string | null
  management_fee_rate: number | null
  management_fee_basis: string | null
  carry_rate: number | null
  hurdle_rate: number | null
  hurdle_type: string | null
  catch_up_rate: number | null
  waterfall_type: string | null
  gp_commit_pct: number | null
  recycling_allowed: boolean | null
  recycling_cap: number | null
  vintage: number | null
  term_years: number | null
  investment_period_years: number | null
  extension_options: string | null
  reporting_frequency: string | null
  audit_required: boolean | null
  created_at: string
  updated_at: string
}

interface FundContractDocument {
  id: string
  portfolio_group: string
  fund_id: string
  name: string
  doc_type: string
  version: string | null
  effective_date: string | null
  url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

const DOC_TYPES = ['LPA', 'SPA', 'NDA', 'Side Letter', 'Amendment', 'Other']

const EMPTY_TERMS: Partial<FundContractTerms> = {
  fund_name: null, cnpj: null,
  gp_name: null, lp_names: null, fund_administrator: null, auditor: null,
  legal_counsel: null,
  management_fee_rate: null, management_fee_basis: null, carry_rate: null,
  hurdle_rate: null, hurdle_type: null, catch_up_rate: null, waterfall_type: null,
  gp_commit_pct: null, recycling_allowed: null, recycling_cap: null,
  vintage: null, term_years: null, investment_period_years: null,
  extension_options: null, reporting_frequency: null, audit_required: null,
}

// ---------------------------------------------------------------------------

interface GroupSummaryFromInvestments {
  group: string
  unrealizedValue: number
  totalInvested: number
}

interface GroupConfig {
  cashOnHand: number
  carryRate: number
  gpCommitPct: number
  vintage: number | null
  managementFeeRate: number
  navMode: 'metric' | 'manual'
  navOverride: number | null
}

const DEFAULT_CONFIG: GroupConfig = {
  cashOnHand: 0,
  carryRate: 0.20,
  gpCommitPct: 0,
  vintage: null,
  managementFeeRate: 0,
  navMode: 'metric',
  navOverride: null,
}

interface FundMetrics {
  committed: number
  called: number
  totalInvested: number
  distributions: number
  cashOnHand: number
  grossResidual: number
  estimatedCarry: number
  netResidual: number
  totalValue: number
  tvpi: number | null
  dpi: number | null
  rvpi: number | null
  netIrr: number | null
  grossMoic: number | null
  netMoic: number | null
  grossIrr: number | null
  grossTvpi: number | null
  netTvpi: number | null
  totalManagementFees: number
  navMode: 'metric' | 'manual'
}

const FLOW_TYPE_LABELS: Record<string, string> = {
  commitment: 'Commitment',
  called_capital: 'Called Capital',
  distribution: 'Distribution',
}

function computeTotalManagementFees(
  committed: number,
  managementFeeRate: number,
  vintage: number | null,
  asOfDate: string
): number {
  if (!managementFeeRate || !vintage || committed <= 0) return 0
  const asOfYear = asOfDate ? new Date(asOfDate + 'T00:00:00').getFullYear() : new Date().getFullYear()
  const years = Math.max(0, asOfYear - vintage)
  return committed * managementFeeRate * years
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function computeFundMetrics(
  cashFlows: FundCashFlow[],
  grossResidualFromInvestments: number,
  totalInvested: number,
  config: GroupConfig,
  asOfDate: string
): FundMetrics {
  const { cashOnHand, carryRate, gpCommitPct, vintage, managementFeeRate, navMode, navOverride } = config

  const filteredFlows = asOfDate
    ? cashFlows.filter(cf => cf.flow_date <= asOfDate)
    : cashFlows

  let called = 0
  let distributions = 0
  let committed = 0

  for (const cf of filteredFlows) {
    if (cf.flow_type === 'called_capital') called += cf.amount
    if (cf.flow_type === 'distribution') distributions += cf.amount
    if (cf.flow_type === 'commitment') committed += cf.amount
  }

  const finalCommitted = committed > 0 ? committed : called

  const grossResidual = navMode === 'manual' && navOverride != null ? navOverride : grossResidualFromInvestments

  const grossAssets = grossResidual + cashOnHand
  const gpCapital = called * gpCommitPct
  const lpCapital = called - gpCapital
  const lpDistributions = distributions * (1 - gpCommitPct)
  const lpRemainingCapital = lpCapital - lpDistributions
  const estimatedCarry = Math.max(0, carryRate * (grossAssets * (1 - gpCommitPct) - lpRemainingCapital))
  const netResidual = grossAssets - estimatedCarry
  const totalValue = distributions + netResidual

  const totalManagementFees = computeTotalManagementFees(finalCommitted, managementFeeRate, vintage, asOfDate)

  const netTvpi = called > 0 ? totalValue / called : null
  const dpi = called > 0 ? distributions / called : null
  const rvpi = called > 0 ? netResidual / called : null

  const grossMoic = totalInvested > 0 ? (distributions + grossResidual) / totalInvested : null
  const netInvestedCalculation = called - totalManagementFees
  const netMoic = netInvestedCalculation > 0 ? totalValue / netInvestedCalculation : null
  const grossTvpi = called > 0 ? (distributions + grossResidual) / called : null

  const asOfDateObj = asOfDate ? parseLocalDate(asOfDate) : new Date()

  const netXirrFlows: CashFlow[] = []
  for (const cf of filteredFlows) {
    if (cf.flow_type === 'called_capital') netXirrFlows.push({ date: parseLocalDate(cf.flow_date), amount: -cf.amount })
    if (cf.flow_type === 'distribution') netXirrFlows.push({ date: parseLocalDate(cf.flow_date), amount: cf.amount })
  }
  if (netResidual > 0) netXirrFlows.push({ date: asOfDateObj, amount: netResidual })
  const netIrr = netXirrFlows.length >= 2 ? xirr(netXirrFlows) : null

  const invRatio = called > 0 ? (totalInvested / called) : 1
  const grossXirrFlows: CashFlow[] = []
  for (const cf of filteredFlows) {
    if (cf.flow_type === 'called_capital') grossXirrFlows.push({ date: parseLocalDate(cf.flow_date), amount: -(cf.amount * invRatio) })
    if (cf.flow_type === 'distribution') grossXirrFlows.push({ date: parseLocalDate(cf.flow_date), amount: cf.amount })
  }
  if (grossResidual > 0) grossXirrFlows.push({ date: asOfDateObj, amount: grossResidual })
  const grossIrr = grossXirrFlows.length >= 2 ? xirr(grossXirrFlows) : null

  return {
    committed: finalCommitted,
    called,
    totalInvested,
    distributions,
    cashOnHand,
    grossResidual,
    estimatedCarry,
    netResidual,
    totalValue,
    tvpi: netTvpi,
    dpi,
    rvpi,
    netIrr,
    grossMoic,
    netMoic,
    grossIrr,
    netTvpi,
    grossTvpi,
    totalManagementFees,
    navMode,
  }
}

function fmtMoic(val: number | null): string {
  if (val == null) return '-'
  return `${val.toFixed(2)}x`
}

function fmtIrr(val: number | null): string {
  if (val == null) return '-'
  const pct = val * 100
  return `${(Object.is(pct, -0) ? 0 : pct).toFixed(1)}%`
}

function formatWithUnit(val: number, unit: DisplayUnit, currency: string): string {
  const symbol = currency === 'BRL' ? 'R$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'
  if (unit === 'millions') return `${symbol}${(val / 1_000_000).toFixed(1)}M`
  if (unit === 'thousands') return `${symbol}${(val / 1_000).toLocaleString('en-US', { maximumFractionDigits: 0 })}K`
  return formatCurrencyFull(val, currency)
}

const MASTER_FUND_KEY = '__master__'

// ---------------------------------------------------------------------------
// ContractualTab
// ---------------------------------------------------------------------------

function ContractualTab({
  group,
  groupConfig,
  onConfigChange,
}: {
  group: string
  groupConfig: GroupConfig
  onConfigChange: (patch: Partial<GroupConfig>) => void
}) {
  const currency = useCurrency()
  const [documents, setDocuments] = useState<FundContractDocument[]>([])
  const [loadingContract, setLoadingContract] = useState(false)
  const [savingTerms, setSavingTerms] = useState(false)
  const [termsDirty, setTermsDirty] = useState(false)
  const [addDocOpen, setAddDocOpen] = useState(false)
  const [docDraft, setDocDraft] = useState({ name: '', docType: 'LPA', version: '', effectiveDate: '', url: '', notes: '' })
  const [savingDoc, setSavingDoc] = useState(false)
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null)
  const [termsDraft, setTermsDraft] = useState<Record<string, string>>({})
  const [termsLoaded, setTermsLoaded] = useState(false)

  const symbol = currency === 'BRL' ? 'R$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'

  const groupConfigRef = useRef(groupConfig)
  useEffect(() => { groupConfigRef.current = groupConfig }, [groupConfig])

  useEffect(() => {
    setTermsLoaded(false)
    async function load() {
      setLoadingContract(true)
      try {
        const res = await fetch(`/api/portfolio/fund-contracts?group=${encodeURIComponent(group)}`)
        if (res.ok) {
          const { terms: t, documents: d } = await res.json()
          const base: Record<string, string> = {}
          if (t && t.length > 0) {
            for (const [k, v] of Object.entries(t[0])) {
              if (v != null) base[k] = String(v)
            }
          }
          const gc = groupConfigRef.current
          if (gc.vintage != null) base['vintage'] = String(gc.vintage)
          else delete base['vintage']
          base['carry_rate'] = String(gc.carryRate * 100)
          base['management_fee_rate'] = String(gc.managementFeeRate * 100)
          base['gp_commit_pct'] = String(gc.gpCommitPct * 100)
          setTermsDraft(base)
          if (d) setDocuments(d)
        }
      } finally {
        setLoadingContract(false)
        setTermsLoaded(true)
      }
    }
    load()
  }, [group])

  useEffect(() => {
    setTermsDraft(prev => {
      const next = { ...prev }
      if (groupConfig.vintage != null) next['vintage'] = String(groupConfig.vintage)
      else delete next['vintage']
      next['carry_rate'] = String(groupConfig.carryRate * 100)
      next['management_fee_rate'] = String(groupConfig.managementFeeRate * 100)
      next['gp_commit_pct'] = String(groupConfig.gpCommitPct * 100)
      return next
    })
  }, [groupConfig.vintage, groupConfig.carryRate, groupConfig.managementFeeRate, groupConfig.gpCommitPct])

  function setDraftField(field: string, value: string) {
    setTermsDraft(prev => ({ ...prev, [field]: value }))
    setTermsDirty(true)
  }

  async function handleSaveTerms() {
    setSavingTerms(true)
    try {
      const contractPayload: Record<string, any> = { portfolioGroup: group }
      for (const [k, v] of Object.entries(termsDraft)) {
        if (v === '') contractPayload[k] = null
        else if (['management_fee_rate', 'carry_rate', 'hurdle_rate', 'catch_up_rate', 'gp_commit_pct', 'recycling_cap', 'vintage', 'term_years', 'investment_period_years'].includes(k)) {
          contractPayload[k] = parseFloat(v)
        } else if (['recycling_allowed', 'audit_required'].includes(k)) {
          contractPayload[k] = v === 'true'
        } else {
          contractPayload[k] = v
        }
      }
      const contractRes = await fetch('/api/portfolio/fund-contracts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contractPayload),
      })
      const configPatch: Record<string, any> = { portfolioGroup: group }
      let hasConfigChanges = false
      const vintageVal = termsDraft['vintage']
      const carryVal = termsDraft['carry_rate']
      const feeVal = termsDraft['management_fee_rate']
      const gpVal = termsDraft['gp_commit_pct']
      if (vintageVal !== undefined) { configPatch['vintage'] = vintageVal === '' ? null : vintageVal; hasConfigChanges = true }
      if (carryVal !== undefined) { configPatch['carryRate'] = carryVal === '' ? 0.20 : parseFloat(carryVal) / 100; hasConfigChanges = true }
      if (feeVal !== undefined) { configPatch['managementFeeRate'] = feeVal === '' ? 0 : parseFloat(feeVal) / 100; hasConfigChanges = true }
      if (gpVal !== undefined) { configPatch['gpCommitPct'] = gpVal === '' ? 0 : parseFloat(gpVal) / 100; hasConfigChanges = true }
      if (hasConfigChanges) {
        const gcRes = await fetch('/api/portfolio/fund-group-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configPatch),
        })
        if (gcRes.ok) {
          const data = await gcRes.json()
          onConfigChange({
            vintage: data.vintage != null ? Number(data.vintage) : null,
            carryRate: data.carry_rate != null ? Number(data.carry_rate) : 0.20,
            managementFeeRate: data.management_fee_rate != null ? Number(data.management_fee_rate) : 0,
            gpCommitPct: Number(data.gp_commit_pct) || 0,
          })
        }
      }
      if (contractRes.ok) setTermsDirty(false)
    } finally {
      setSavingTerms(false)
    }
  }

  async function handleAddDocument() {
    if (!docDraft.name) return
    setSavingDoc(true)
    try {
      const res = await fetch('/api/portfolio/fund-contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioGroup: group,
          name: docDraft.name,
          docType: docDraft.docType,
          version: docDraft.version || null,
          effectiveDate: docDraft.effectiveDate || null,
          url: docDraft.url || null,
          notes: docDraft.notes || null,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        setDocuments(prev => [created, ...prev])
        setDocDraft({ name: '', docType: 'LPA', version: '', effectiveDate: '', url: '', notes: '' })
        setAddDocOpen(false)
      }
    } finally {
      setSavingDoc(false)
    }
  }

  async function handleDeleteDocument(id: string) {
    setDeletingDocId(id)
    try {
      const res = await fetch(`/api/portfolio/fund-contracts?id=${id}`, { method: 'DELETE' })
      if (res.ok) setDocuments(prev => prev.filter(d => d.id !== id))
    } finally {
      setDeletingDocId(null)
    }
  }

  if (loadingContract) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" />Loading contractual data...
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-semibold mb-3">Fund Identity</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">Fund Name</label>
            <input type="text" value={termsDraft['fund_name'] ?? group} onChange={e => setDraftField('fund_name', e.target.value)} placeholder={group} className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">CNPJ</label>
            <input type="text" value={termsDraft['cnpj'] ?? ''} onChange={e => setDraftField('cnpj', e.target.value)} placeholder="00.000.000/0001-00" className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Vintage</label>
            <input type="number" step="1" min="1900" max="2100" value={termsDraft['vintage'] ?? ''} onChange={e => setDraftField('vintage', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Carry Rate (%)</label>
            <input type="number" step="0.01" value={termsDraft['carry_rate'] ?? ''} onChange={e => setDraftField('carry_rate', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">GP Commit (%)</label>
            <input type="number" step="0.01" value={termsDraft['gp_commit_pct'] ?? ''} onChange={e => setDraftField('gp_commit_pct', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Mgmt Fee (% p.a.)</label>
            <input type="number" step="0.01" value={termsDraft['management_fee_rate'] ?? ''} onChange={e => setDraftField('management_fee_rate', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Mgmt Fee Basis</label>
            <input type="text" value={termsDraft['management_fee_basis'] ?? ''} onChange={e => setDraftField('management_fee_basis', e.target.value)} placeholder="e.g. committed capital" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-3">Key Parties</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">GP Name</label>
            <input type="text" value={termsDraft['gp_name'] ?? ''} onChange={e => setDraftField('gp_name', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">LP Names</label>
            <input type="text" value={termsDraft['lp_names'] ?? ''} onChange={e => setDraftField('lp_names', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Fund Administrator</label>
            <input type="text" value={termsDraft['fund_administrator'] ?? ''} onChange={e => setDraftField('fund_administrator', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Auditor</label>
            <input type="text" value={termsDraft['auditor'] ?? ''} onChange={e => setDraftField('auditor', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Legal Counsel</label>
            <input type="text" value={termsDraft['legal_counsel'] ?? ''} onChange={e => setDraftField('legal_counsel', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-3">Economics</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Hurdle Rate (%)</label>
            <input type="number" step="0.01" value={termsDraft['hurdle_rate'] ?? ''} onChange={e => setDraftField('hurdle_rate', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Hurdle Type</label>
            <input type="text" value={termsDraft['hurdle_type'] ?? ''} onChange={e => setDraftField('hurdle_type', e.target.value)} placeholder="e.g. preferred return" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Catch-up Rate (%)</label>
            <input type="number" step="0.01" value={termsDraft['catch_up_rate'] ?? ''} onChange={e => setDraftField('catch_up_rate', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Waterfall Type</label>
            <input type="text" value={termsDraft['waterfall_type'] ?? ''} onChange={e => setDraftField('waterfall_type', e.target.value)} placeholder="e.g. European" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Recycling Allowed</label>
            <Select value={termsDraft['recycling_allowed'] ?? ''} onValueChange={v => setDraftField('recycling_allowed', v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Yes</SelectItem>
                <SelectItem value="false">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Recycling Cap ({symbol})</label>
            <input type="number" step="0.01" value={termsDraft['recycling_cap'] ?? ''} onChange={e => setDraftField('recycling_cap', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent" />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-3">Fund Structure</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Term (years)</label>
            <input type="number" step="1" value={termsDraft['term_years'] ?? ''} onChange={e => setDraftField('term_years', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Investment Period (years)</label>
            <input type="number" step="1" value={termsDraft['investment_period_years'] ?? ''} onChange={e => setDraftField('investment_period_years', e.target.value)} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Extension Options</label>
            <input type="text" value={termsDraft['extension_options'] ?? ''} onChange={e => setDraftField('extension_options', e.target.value)} placeholder="e.g. 2 × 1 year" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Reporting Frequency</label>
            <input type="text" value={termsDraft['reporting_frequency'] ?? ''} onChange={e => setDraftField('reporting_frequency', e.target.value)} placeholder="e.g. Quarterly" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Audit Required</label>
            <Select value={termsDraft['audit_required'] ?? ''} onValueChange={v => setDraftField('audit_required', v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Yes</SelectItem>
                <SelectItem value="false">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {termsDirty && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSaveTerms} disabled={savingTerms}>
            {savingTerms && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save Changes
          </Button>
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Documents</h3>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => setAddDocOpen(true)}>
            <FilePlus className="h-3.5 w-3.5 mr-1" />Add Document
          </Button>
        </div>
        {addDocOpen && (
          <div className="border rounded-lg p-3 mb-3 space-y-3 bg-muted/30">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Document Name *</label>
                <input type="text" value={docDraft.name} onChange={e => setDocDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Limited Partnership Agreement" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" autoFocus />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                <Select value={docDraft.docType} onValueChange={v => setDocDraft(d => ({ ...d, docType: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Version</label>
                <input type="text" value={docDraft.version} onChange={e => setDocDraft(d => ({ ...d, version: e.target.value }))} placeholder="v1.0" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Effective Date</label>
                <input type="date" value={docDraft.effectiveDate} onChange={e => setDocDraft(d => ({ ...d, effectiveDate: e.target.value }))} className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">URL</label>
                <input type="url" value={docDraft.url} onChange={e => setDocDraft(d => ({ ...d, url: e.target.value }))} placeholder="https://..." className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
              </div>
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
                <input type="text" value={docDraft.notes} onChange={e => setDocDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Optional notes" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddDocument} disabled={savingDoc || !docDraft.name}>
                {savingDoc && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAddDocOpen(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {documents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No documents added yet.</p>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-left px-3 py-2 font-medium">Version</th>
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Notes</th>
                  <th className="px-3 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {documents.map(doc => (
                  <tr key={doc.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      {doc.url ? (
                        <a href={doc.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                          {doc.name}<ExternalLink className="h-3 w-3" />
                        </a>
                      ) : doc.name}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{doc.doc_type}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{doc.version ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{doc.effective_date ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{doc.notes ?? '—'}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => handleDeleteDocument(doc.id)} disabled={deletingDocId === doc.id} className="text-muted-foreground hover:text-red-600">
                        {deletingDocId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
