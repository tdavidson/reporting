'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Trash2, Save, X, Pencil, Briefcase, Lock, Upload, GripVertical, BarChart2, SlidersHorizontal, FileText, ExternalLink, FilePlus, Sparkles } from 'lucide-react'
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
import { ContractualTab } from '@/components/contractual-tab'


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
// Main page
// ---------------------------------------------------------------------------

export default function FundsPage() {
  const fv = useFeatureVisibility()
  const currency = useCurrency()

  const [cashFlows, setCashFlows] = useState<FundCashFlow[]>([])
  const [investmentGroups, setInvestmentGroups] = useState<GroupSummaryFromInvestments[]>([])
  const [groupConfigs, setGroupConfigs] = useState<Record<string, GroupConfig>>({})
  const [loading, setLoading] = useState(false)
  const [asOfDate, setAsOfDate] = useState('')
  const { displayUnit, setDisplayUnit } = useDisplayUnit()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ flowDate: '', flowType: '', amount: '', notes: '', portfolioGroup: '' })
  const [addingGroup, setAddingGroup] = useState<string | null>(null)
  const [addDraft, setAddDraft] = useState({ flowDate: '', flowType: 'commitment', amount: '', notes: '', portfolioGroup: '' })
  const [saving, setSaving] = useState(false)
  const [activeInnerTab, setActiveInnerTab] = useState<Record<string, string>>({})

  const [editingNavGroup, setEditingNavGroup] = useState<string | null>(null)
  const [navOverrideDraft, setNavOverrideDraft] = useState<Record<string, string>>({})
  const [savingNav, setSavingNav] = useState(false)

  const [importOpen, setImportOpen] = useState(false)
  const [importData, setImportData] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ created: number; errors: string[] } | null>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDrafts, setSettingsDrafts] = useState<Record<string, {
    carryRate: string
    gpCommitPct: string
    vintage: string
    managementFeeRate: string
  }>>({})
  const [savingSettings, setSavingSettings] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deletingGroupSaving, setDeletingGroupSaving] = useState(false)
  const [portfolioIRR, setPortfolioIRR] = useState<number | null>(null)
  const [portfolioMOIC, setPortfolioMOIC] = useState<number | null>(null)
  const [groupOrder, setGroupOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('fund-group-order')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null)
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('asOfDate') ?? new Date().toISOString().split('T')[0]
    setAsOfDate(saved)
  }, [])

  useEffect(() => {
    if (!asOfDate) return
    async function load() {
      setLoading(true)
      try {
        const [cfRes, invRes, gcRes] = await Promise.all([
          fetch('/api/portfolio/fund-cash-flows'),
          fetch(`/api/portfolio/investments?asOf=${asOfDate}`),
          fetch('/api/portfolio/fund-group-config'),
        ])
        if (cfRes.ok) setCashFlows(await cfRes.json())
        if (invRes.ok) {
          const invData = await invRes.json()
          setPortfolioIRR(invData.portfolioIRR ?? null)
          setPortfolioMOIC(invData.portfolioMOIC ?? null)
          setInvestmentGroups(
            (invData.groups ?? []).map((g: any) => ({
              group: g.group,
              unrealizedValue: g.unrealizedValue ?? 0,
              totalInvested: g.totalInvested ?? 0,
            }))
          )
        }
        if (gcRes.ok) {
          const configs = await gcRes.json()
          const map: Record<string, GroupConfig> = {}
          for (const c of configs) {
            map[c.portfolio_group] = {
              cashOnHand: Number(c.cash_on_hand) || 0,
              carryRate: c.carry_rate != null ? Number(c.carry_rate) : 0.20,
              gpCommitPct: Number(c.gp_commit_pct) || 0,
              vintage: c.vintage != null ? Number(c.vintage) : null,
              managementFeeRate: c.management_fee_rate != null ? Number(c.management_fee_rate) : 0,
              navMode: c.nav_mode === 'manual' ? 'manual' : 'metric',
              navOverride: c.nav_override != null ? Number(c.nav_override) : null,
            }
          }
          setGroupConfigs(map)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [asOfDate])

  const handleContractualConfigChange = useCallback((group: string, patch: Partial<GroupConfig>) => {
    setGroupConfigs(prev => ({
      ...prev,
      [group]: { ...(prev[group] ?? DEFAULT_CONFIG), ...patch },
    }))
  }, [])

  const groups = useMemo(() => {
    const set = new Set<string>()
    for (const cf of cashFlows) set.add(cf.portfolio_group)
    for (const g of investmentGroups) if (g.group) set.add(g.group)
    const sorted = Array.from(set).sort()
    setGroupOrder(prev => {
      try {
        const saved = localStorage.getItem('fund-group-order')
        const savedOrder: string[] = saved ? JSON.parse(saved) : []
        const base = savedOrder.length > 0 ? savedOrder : prev.length > 0 ? prev : sorted
        const newGroups = sorted.filter(g => !base.includes(g))
        return [...base.filter(g => sorted.includes(g)), ...newGroups]
      } catch {
        if (prev.length === 0) return sorted
        const newGroups = sorted.filter(g => !prev.includes(g))
        return [...prev.filter(g => sorted.includes(g)), ...newGroups]
      }
    })
    return sorted
  }, [cashFlows, investmentGroups])

  const orderedGroups = useMemo(() => {
    if (groupOrder.length === 0) return groups
    return [...groupOrder].filter(g => groups.includes(g))
  }, [groups, groupOrder])

  const grossResidualByGroup = useMemo(() => {
    const map = new Map<string, number>()
    for (const g of investmentGroups) map.set(g.group, g.unrealizedValue)
    return map
  }, [investmentGroups])

  const totalInvestedByGroup = useMemo(() => {
    const map = new Map<string, number>()
    for (const g of investmentGroups) map.set(g.group, g.totalInvested)
    return map
  }, [investmentGroups])

  const metricsByGroup = useMemo(() => {
    const map = new Map<string, FundMetrics>()
    for (const group of groups) {
      const groupFlows = cashFlows.filter(cf => cf.portfolio_group === group)
      const grossResidual = grossResidualByGroup.get(group) ?? 0
      const totalInvested = totalInvestedByGroup.get(group) ?? 0
      const config = groupConfigs[group] ?? DEFAULT_CONFIG
      map.set(group, computeFundMetrics(groupFlows, grossResidual, totalInvested, config, asOfDate))
    }
    return map
  }, [groups, cashFlows, grossResidualByGroup, totalInvestedByGroup, groupConfigs, asOfDate])

  const masterMetrics = useMemo(() => {
    let called = 0
    let distributions = 0
    let netResidual = 0
    let committed = 0
    let grossResidual = 0
    let totalInvested = 0
    let cashOnHand = 0
    let estimatedCarry = 0
    let totalManagementFees = 0

    const asOfDateObj = asOfDate ? parseLocalDate(asOfDate) : new Date()
    const netXirrFlows: CashFlow[] = []

    for (const group of groups) {
      const m = metricsByGroup.get(group)
      if (!m) continue

      called += m.called
      distributions += m.distributions
      netResidual += m.netResidual
      committed += m.committed
      grossResidual += m.grossResidual
      totalInvested += m.totalInvested
      cashOnHand += m.cashOnHand
      estimatedCarry += m.estimatedCarry
      totalManagementFees += m.totalManagementFees

      const groupFlows = cashFlows.filter(cf =>
        cf.portfolio_group === group &&
        (!asOfDate || cf.flow_date <= asOfDate)
      )
      for (const cf of groupFlows) {
        if (cf.flow_type === 'called_capital') netXirrFlows.push({ date: parseLocalDate(cf.flow_date), amount: -cf.amount })
        if (cf.flow_type === 'distribution') netXirrFlows.push({ date: parseLocalDate(cf.flow_date), amount: cf.amount })
      }
    }

    if (netResidual > 0) netXirrFlows.push({ date: asOfDateObj, amount: netResidual })

    let netIrr = null
    if (netXirrFlows.length >= 2) {
      try { netIrr = xirr(netXirrFlows) } catch (e) { console.error(e) }
    }
    const totalValue = distributions + netResidual

    const tvpi = called > 0 ? totalValue / called : null
    const dpi = called > 0 ? distributions / called : null
    const rvpi = called > 0 ? netResidual / called : null
    const grossTvpi = called > 0 ? (distributions + grossResidual) / called : null

    return {
      committed, called, totalInvested, distributions,
      cashOnHand, grossResidual, estimatedCarry, netResidual, totalValue,
      tvpi, dpi, rvpi, netIrr,
      grossMoic: portfolioMOIC,
      netMoic: tvpi,
      grossIrr: portfolioIRR,
      netTvpi: tvpi, grossTvpi,
      totalManagementFees,
      navMode: 'metric' as const,
    }
  }, [cashFlows, groups, metricsByGroup, portfolioIRR, portfolioMOIC, asOfDate])

  const fmt = (val: number) => formatWithUnit(val, displayUnit, currency)
  const fmtCard = (val: number) => {
    const symbol = currency === 'BRL' ? 'R$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'
    return `${symbol}${(val / 1_000_000).toFixed(1)}M`
  }

  const masterCumulatives = useMemo(() => {
    let cumulCalled = 0
    let cumulDistributed = 0
    const map: Record<string, { called: number; distributed: number }> = {}
    ;[...cashFlows]
      .sort((a, b) => a.flow_date.localeCompare(b.flow_date))
      .forEach(cf => {
        if (cf.flow_type === 'called_capital') cumulCalled += cf.amount
        if (cf.flow_type === 'distribution') cumulDistributed += cf.amount
        map[cf.id] = { called: cumulCalled, distributed: cumulDistributed }
      })
    return map
  }, [cashFlows])

  const startEdit = useCallback((cf: FundCashFlow) => {
    setEditingId(cf.id)
    setEditDraft({
      flowDate: cf.flow_date,
      flowType: cf.flow_type,
      amount: String(cf.amount),
      notes: cf.notes ?? '',
      portfolioGroup: cf.portfolio_group,
    })
  }, [])

  async function handleSaveEdit() {
    if (!editingId) return
    setSaving(true)
    try {
      const res = await fetch('/api/portfolio/fund-cash-flows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          flowDate: editDraft.flowDate,
          flowType: editDraft.flowType,
          amount: editDraft.amount,
          notes: editDraft.notes || null,
          portfolioGroup: editDraft.portfolioGroup,
        }),
      })
      if (res.ok) {
        const updated = await res.json()
        setCashFlows(prev => prev.map(cf => cf.id === editingId ? updated : cf))
        setEditingId(null)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/portfolio/fund-cash-flows?id=${id}`, { method: 'DELETE' })
    if (res.ok) setCashFlows(prev => prev.filter(cf => cf.id !== id))
  }

  async function handleAdd(group: string) {
    if (!addDraft.flowDate || !addDraft.amount) return
    setSaving(true)
    try {
      const res = await fetch('/api/portfolio/fund-cash-flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioGroup: group,
          flowDate: addDraft.flowDate,
          flowType: addDraft.flowType,
          amount: addDraft.amount,
          notes: addDraft.notes || null,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        setCashFlows(prev => [...prev, created].sort((a, b) => a.flow_date.localeCompare(b.flow_date)))
        setAddingGroup(null)
        setAddDraft({ flowDate: '', flowType: 'commitment', amount: '', notes: '', portfolioGroup: '' })
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleNavMode(group: string) {
    const current = groupConfigs[group]?.navMode ?? 'metric'
    const next = current === 'metric' ? 'manual' : 'metric'
    const res = await fetch('/api/portfolio/fund-group-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolioGroup: group, navMode: next }),
    })
    if (res.ok) {
      setGroupConfigs(prev => ({
        ...prev,
        [group]: { ...(prev[group] ?? DEFAULT_CONFIG), navMode: next },
      }))
      if (next === 'manual') {
        setEditingNavGroup(group)
        setNavOverrideDraft(prev => ({ ...prev, [group]: String(groupConfigs[group]?.navOverride ?? '') }))
      } else {
        setEditingNavGroup(null)
      }
    }
  }

  async function handleSaveNavOverride(group: string) {
    setSavingNav(true)
    try {
      const res = await fetch('/api/portfolio/fund-group-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioGroup: group,
          navOverride: navOverrideDraft[group] ?? null,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setGroupConfigs(prev => ({
          ...prev,
          [group]: { ...(prev[group] ?? DEFAULT_CONFIG), navOverride: data.nav_override != null ? Number(data.nav_override) : null },
        }))
        setEditingNavGroup(null)
      }
    } finally {
      setSavingNav(false)
    }
  }

  async function handleImport() {
    if (!importData.trim()) return
    setImporting(true)
    setImportResult(null)
    try {
      const res = await fetch('/api/portfolio/fund-cash-flows/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: importData }),
      })
      const result = await res.json()
      if (res.ok) {
        setImportResult(result)
        setImportData('')
        const cfRes = await fetch('/api/portfolio/fund-cash-flows')
        if (cfRes.ok) setCashFlows(await cfRes.json())
      } else {
        setImportResult({ created: 0, errors: [result.error || 'Import failed'] })
      }
    } finally {
      setImporting(false)
    }
  }

  function openSettings() {
    const drafts: Record<string, any> = {}
    for (const group of groups) {
      const config = groupConfigs[group] ?? DEFAULT_CONFIG
      drafts[group] = {
        carryRate: String(config.carryRate * 100),
        gpCommitPct: String(config.gpCommitPct * 100),
        vintage: config.vintage != null ? String(config.vintage) : '',
        managementFeeRate: String(config.managementFeeRate * 100),
      }
    }
    setSettingsDrafts(drafts)
    setSettingsOpen(true)
  }

  async function handleDeleteGroup(group: string) {
    setDeletingGroupSaving(true)
    try {
      const res = await fetch(`/api/portfolio/fund-cash-flows?portfolioGroup=${encodeURIComponent(group)}`, { method: 'DELETE' })
      if (res.ok) {
        setCashFlows(prev => prev.filter(cf => cf.portfolio_group !== group))
        setGroupConfigs(prev => {
          const next = { ...prev }
          delete next[group]
          return next
        })
        setDeletingGroup(null)
        setDeleteConfirmName('')
        setSettingsOpen(false)
      }
    } finally {
      setDeletingGroupSaving(false)
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true)
    try {
      for (const group of groups) {
        const draft = settingsDrafts[group]
        if (!draft) continue
        const res = await fetch('/api/portfolio/fund-group-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            portfolioGroup: group,
            carryRate: parseFloat(draft.carryRate || '20') / 100,
            gpCommitPct: parseFloat(draft.gpCommitPct || '0') / 100,
            vintage: draft.vintage || null,
            managementFeeRate: parseFloat(draft.managementFeeRate || '0') / 100,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          setGroupConfigs(prev => ({
            ...prev,
            [group]: {
              ...(prev[group] ?? DEFAULT_CONFIG),
              carryRate: data.carry_rate != null ? Number(data.carry_rate) : 0.20,
              gpCommitPct: Number(data.gp_commit_pct) || 0,
              vintage: data.vintage != null ? Number(data.vintage) : null,
              managementFeeRate: data.management_fee_rate != null ? Number(data.management_fee_rate) : 0,
            },
          }))
        }
      }
      setSettingsOpen(false)
    } finally {
      setSavingSettings(false)
    }
  }

  function handleDragStart(group: string) {
    setDraggedGroup(group)
  }

  function handleDragOver(e: React.DragEvent, group: string) {
    e.preventDefault()
    setDragOverGroup(group)
  }

  function handleDrop(targetGroup: string) {
    if (!draggedGroup || draggedGroup === targetGroup) {
      setDraggedGroup(null)
      setDragOverGroup(null)
      return
    }
    setGroupOrder(prev => {
      const order = prev.length > 0 ? prev : groups
      const from = order.indexOf(draggedGroup)
      const to = order.indexOf(targetGroup)
      const next = [...order]
      next.splice(from, 1)
      next.splice(to, 0, draggedGroup)
      localStorage.setItem('fund-group-order', JSON.stringify(next))
      return next
    })
    setDraggedGroup(null)
    setDragOverGroup(null)
  }

  function MetricCards({ metrics, group }: { metrics: FundMetrics; group?: string }) {
    const config = group ? (groupConfigs[group] ?? DEFAULT_CONFIG) : null
    const isManual = config?.navMode === 'manual'
    const isEditingNav = group ? editingNavGroup === group : false

    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Called', value: fmtCard(metrics.called) },
          { label: 'Invested', value: fmtCard(metrics.totalInvested) },
          { label: 'Distributions', value: fmtCard(metrics.distributions) },
        ].map(card => (
          <Card key={card.label}>
            <CardContent className="pt-3 pb-2 px-3">
              <p className="text-[11px] text-muted-foreground mb-0.5">{card.label}</p>
              <p className="text-lg font-semibold">{card.value}</p>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardContent className="pt-3 pb-2 px-3">
            <div className="flex items-center justify-between mb-0.5">
              <p className="text-[11px] text-muted-foreground">Portfolio NAV</p>
              {group && (
                <button
                  onClick={() => handleToggleNavMode(group)}
                  title={isManual ? 'Switch to NAV via metric' : 'Switch to Manual NAV'}
                  className={`flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5 transition-colors ${
                    isManual
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {isManual ? (
                    <><SlidersHorizontal className="h-3 w-3" /><span className="ml-0.5">Manual</span></>
                  ) : (
                    <><BarChart2 className="h-3 w-3" /><span className="ml-0.5">Metric</span></>
                  )}
                </button>
              )}
            </div>

            {group && isManual ? (
              isEditingNav ? (
                <input
                  type="number"
                  step="0.01"
                  autoFocus
                  value={navOverrideDraft[group] ?? ''}
                  onChange={e => setNavOverrideDraft(prev => ({ ...prev, [group]: e.target.value }))}
                  onBlur={() => handleSaveNavOverride(group)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveNavOverride(group)
                    if (e.key === 'Escape') setEditingNavGroup(null)
                  }}
                  placeholder="0"
                  className="border rounded px-1.5 py-0.5 text-lg font-semibold w-full font-mono bg-transparent"
                />
              ) : (
                <button
                  className="text-left w-full group"
                  onClick={() => {
                    setEditingNavGroup(group)
                    setNavOverrideDraft(prev => ({ ...prev, [group]: String(config?.navOverride ?? '') }))
                  }}
                >
                  <p className="text-lg font-semibold group-hover:underline decoration-dotted">
                    {config?.navOverride != null ? fmtCard(config.navOverride) : <span className="text-muted-foreground text-sm">Set NAV…</span>}
                  </p>
                </button>
              )
            ) : (
              <p className="text-lg font-semibold">{fmtCard(metrics.grossResidual)}</p>
            )}
          </CardContent>
        </Card>

        {[
          { label: 'Gross IRR', value: fmtIrr(metrics.grossIrr) },
          { label: 'Gross MOIC', value: fmtMoic(metrics.grossMoic) },
          { label: 'Gross TVPI', value: fmtMoic(metrics.grossTvpi) },
          { label: 'DPI', value: fmtMoic(metrics.dpi) },
          { label: 'Net IRR', value: fmtIrr(metrics.netIrr) },
          { label: 'Net MOIC', value: fmtMoic(metrics.netMoic) },
          { label: 'Net TVPI', value: fmtMoic(metrics.netTvpi) },
          { label: 'RVPI', value: fmtMoic(metrics.rvpi) },
        ].map(card => (
          <Card key={card.label}>
            <CardContent className="pt-3 pb-2 px-3">
              <p className="text-[11px] text-muted-foreground mb-0.5">{card.label}</p>
              <p className="text-lg font-semibold">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  const heading = (
    <div className="mb-6 space-y-1">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          {fv.funds === 'admin' && <Lock className="h-4 w-4 text-amber-500" />}Funds
        </h1>
        <span className="flex items-center gap-2">
          <PortfolioNotesButton />
          <AnalystToggleButton />
        </span>
      </div>
      <p className="text-sm text-muted-foreground">Fund-level cash flows, NAV, and performance metrics</p>
      <div className="flex items-center gap-2 pt-2">
        <span className="text-sm text-muted-foreground">As of</span>
        <input
          type="date"
          value={asOfDate}
          onChange={e => {
            setAsOfDate(e.target.value)
            localStorage.setItem('asOfDate', e.target.value)
          }}
          className="border rounded px-2 py-1 text-sm"
        />
      </div>
    </div>
  )

  if (loading || !asOfDate) {
    return (
      <PortfolioNotesProvider pageContext="funds">
        <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
          {heading}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Loading...
          </div>
        </div>
      </PortfolioNotesProvider>
    )
  }

  if (groups.length === 0) {
    return (
      <PortfolioNotesProvider pageContext="funds">
        <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
          {heading}
          <p className="text-sm text-muted-foreground">
            No fund cash flows yet. Add cash flows from the Import page or from individual group tabs.
          </p>
        </div>
      </PortfolioNotesProvider>
    )
  }

  return (
    <PortfolioNotesProvider pageContext="funds">
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      {heading}

      <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0 w-full">
      <Tabs defaultValue={MASTER_FUND_KEY} className="w-full">
        <div className="flex items-center gap-2 mb-4">
          <div
            className="overflow-x-auto cursor-grab active:cursor-grabbing select-none"
            style={{ scrollbarWidth: 'none' }}
            onMouseDown={e => {
              const el = e.currentTarget
              let startX = e.pageX - el.offsetLeft
              let scrollLeft = el.scrollLeft
              const onMove = (ev: MouseEvent) => {
                const x = ev.pageX - el.offsetLeft
                el.scrollLeft = scrollLeft - (x - startX)
              }
              const onUp = () => {
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onUp)
              }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }}
          >
            <TabsList className="flex-nowrap whitespace-nowrap">
              <TabsTrigger
                value={MASTER_FUND_KEY}
                className="data-[state=active]:bg-[#0F2332] data-[state=active]:text-white"
              >
                Prlx Fund I
              </TabsTrigger>
              {orderedGroups.map(g => (
                <TabsTrigger
                  key={g}
                  value={g}
                  className="data-[state=active]:bg-[#0F2332] data-[state=active]:text-white"
                >
                  {g || '(none)'}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <button
            onClick={openSettings}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-accent transition-colors flex-shrink-0"
            title="Edit Fund Settings"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>

        {/* Master Fund Tab */}
        <TabsContent value={MASTER_FUND_KEY}>
          <p className="text-xs text-muted-foreground mb-3">Consolidated view across all vehicles</p>
          <MetricCards metrics={masterMetrics} />

          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-left px-3 py-2 font-medium">Group</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                  <th className="text-right px-3 py-2 font-medium">Capital Called</th>
                  <th className="text-right px-3 py-2 font-medium">Capital Distributed</th>
                </tr>
              </thead>
              <tbody>
                {[...cashFlows]
                  .filter(cf => !asOfDate || cf.flow_date <= asOfDate)
                  .sort((a, b) => a.flow_date.localeCompare(b.flow_date))
                  .map(cf => (
                    <tr key={cf.id} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="px-3 py-2">{cf.flow_date}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          cf.flow_type === 'commitment' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                          cf.flow_type === 'called_capital' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                          'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        }`}>
                          {FLOW_TYPE_LABELS[cf.flow_type]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{cf.portfolio_group}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(cf.amount)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(masterCumulatives[cf.id]?.called ?? 0)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(masterCumulatives[cf.id]?.distributed ?? 0)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Individual Group Tabs */}
        {orderedGroups.map(group => {
          const metrics = metricsByGroup.get(group)!
          const groupFlows = cashFlows
            .filter(cf => cf.portfolio_group === group && (!asOfDate || cf.flow_date <= asOfDate))
            .sort((a, b) => a.flow_date.localeCompare(b.flow_date))

          let cumulCalled = 0
          let cumulDistributed = 0
          const rowCumulatives = groupFlows.map(cf => {
            if (cf.flow_type === 'called_capital') cumulCalled += cf.amount
            if (cf.flow_type === 'distribution') cumulDistributed += cf.amount
            return { called: cumulCalled, distributed: cumulDistributed }
          })

          return (
            <TabsContent key={group} value={group}>
              {groupConfigs[group]?.vintage && (
                <p className="text-xs text-muted-foreground mb-3">Vintage {groupConfigs[group].vintage}</p>
              )}

{(activeInnerTab[group] ?? 'cashflows') === 'cashflows' && (
  <MetricCards metrics={metrics} group={group} />
)}

<Tabs
  defaultValue="cashflows"
  onValueChange={val => setActiveInnerTab(prev => ({ ...prev, [group]: val }))}
  className="w-full"
>
  <TabsList className="mb-4">
    <TabsTrigger value="cashflows" className="text-xs">Cash Flows</TabsTrigger>
    <TabsTrigger value="contractual" className="text-xs">Contractual</TabsTrigger>
  </TabsList>

                <TabsContent value="cashflows">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">Cash Flows — {group}</h3>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline" size="sm" className="text-xs"
                        onClick={() => {
                          setAddingGroup(group)
                          setAddDraft({ flowDate: new Date().toISOString().split('T')[0], flowType: 'commitment', amount: '', notes: '', portfolioGroup: group })
                        }}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />Add
                      </Button>
                    </div>
                  </div>

                  {addingGroup === group && (
                    <div className="border rounded-lg p-3 mb-3 space-y-2 bg-muted/30">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Date</label>
                          <input type="date" value={addDraft.flowDate} onChange={e => setAddDraft(d => ({ ...d, flowDate: e.target.value }))} className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" autoFocus />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                          <Select value={addDraft.flowType} onValueChange={v => setAddDraft(d => ({ ...d, flowType: v }))}>
                            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="commitment">Commitment</SelectItem>
                              <SelectItem value="called_capital">Called Capital</SelectItem>
                              <SelectItem value="distribution">Distribution</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Amount</label>
                          <input type="number" step="0.01" value={addDraft.amount} onChange={e => setAddDraft(d => ({ ...d, amount: e.target.value }))} placeholder="0" className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent" />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
                          <input type="text" value={addDraft.notes} onChange={e => setAddDraft(d => ({ ...d, notes: e.target.value }))} placeholder="—" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleAdd(group)} disabled={saving || !addDraft.flowDate || !addDraft.amount}>
                          {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setAddingGroup(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  <div className="border rounded-lg overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left px-3 py-2 font-medium">Date</th>
                          <th className="text-left px-3 py-2 font-medium">Type</th>
                          <th className="text-right px-3 py-2 font-medium">Amount</th>
                          <th className="text-right px-3 py-2 font-medium">Capital Called</th>
                          <th className="text-right px-3 py-2 font-medium">Capital Distributed</th>
                          <th className="text-left px-3 py-2 font-medium">Notes</th>
                          <th className="px-3 py-2 w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupFlows.map((cf, i) => (
                          <tr key={cf.id} className="border-b last:border-b-0 hover:bg-muted/30">
                            {editingId === cf.id ? (
                              <>
                                <td className="px-3 py-2"><input type="date" value={editDraft.flowDate} onChange={e => setEditDraft(d => ({ ...d, flowDate: e.target.value }))} className="border rounded px-1.5 py-0.5 text-sm w-full bg-transparent" autoFocus /></td>
                                <td className="px-3 py-2">
                                  <Select value={editDraft.flowType} onValueChange={v => setEditDraft(d => ({ ...d, flowType: v }))}>
                                    <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="commitment">Commitment</SelectItem>
                                      <SelectItem value="called_capital">Called Capital</SelectItem>
                                      <SelectItem value="distribution">Distribution</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="px-3 py-2"><input type="number" step="0.01" value={editDraft.amount} onChange={e => setEditDraft(d => ({ ...d, amount: e.target.value }))} className="border rounded px-1.5 py-0.5 text-sm w-28 font-mono text-right bg-transparent" /></td>
                                <td className="px-3 py-2 text-right font-mono">{fmt(rowCumulatives[i]?.called ?? 0)}</td>
                                <td className="px-3 py-2 text-right font-mono">{fmt(rowCumulatives[i]?.distributed ?? 0)}</td>
                                <td className="px-3 py-2"><input type="text" value={editDraft.notes} onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))} placeholder="—" className="border rounded px-1.5 py-0.5 text-sm w-full bg-transparent" /></td>
                                <td className="px-3 py-2">
                                  <div className="flex gap-1">
                                    <button onClick={handleSaveEdit} disabled={saving} className="text-primary hover:text-primary/80">
                                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                    </button>
                                    <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-3 py-2">{cf.flow_date}</td>
                                <td className="px-3 py-2">
                                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                                    cf.flow_type === 'commitment' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                                    cf.flow_type === 'called_capital' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                                    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  }`}>
                                    {FLOW_TYPE_LABELS[cf.flow_type]}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right font-mono">{fmt(cf.amount)}</td>
                                <td className="px-3 py-2 text-right font-mono">{fmt(rowCumulatives[i]?.called ?? 0)}</td>
                                <td className="px-3 py-2 text-right font-mono">{fmt(rowCumulatives[i]?.distributed ?? 0)}</td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">{cf.notes ?? '—'}</td>
                                <td className="px-3 py-2">
                                  <div className="flex gap-1">
                                    <button onClick={() => startEdit(cf)} className="text-muted-foreground hover:text-foreground">
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button onClick={() => handleDelete(cf.id)} className="text-muted-foreground hover:text-red-600">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>

                <TabsContent value="contractual">
                  <ContractualTab
                    group={group}
                    groupConfig={groupConfigs[group] ?? DEFAULT_CONFIG}
                    onConfigChange={patch => handleContractualConfigChange(group, patch)}
                  />
                </TabsContent>
              </Tabs>
            </TabsContent>
          )
        })}
      </Tabs>
      </div>

      <AnalystPanel />
      </div>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Fund Settings</DialogTitle>
            <DialogDescription>Configure carry rate, GP commit, vintage, and management fee for each fund group.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
            {groups.map(group => (
              <div key={group} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">{group || '(unnamed)'}</h4>
                  <button
                    onClick={() => setDeletingGroup(group)}
                    className="text-xs text-muted-foreground hover:text-red-600 flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" />Delete group
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Carry Rate (%)</label>
                    <input
                      type="number" step="0.01"
                      value={settingsDrafts[group]?.carryRate ?? ''}
                      onChange={e => setSettingsDrafts(prev => ({ ...prev, [group]: { ...prev[group], carryRate: e.target.value } }))}
                      className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">GP Commit (%)</label>
                    <input
                      type="number" step="0.01"
                      value={settingsDrafts[group]?.gpCommitPct ?? ''}
                      onChange={e => setSettingsDrafts(prev => ({ ...prev, [group]: { ...prev[group], gpCommitPct: e.target.value } }))}
                      className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Vintage</label>
                    <input
                      type="number" step="1"
                      value={settingsDrafts[group]?.vintage ?? ''}
                      onChange={e => setSettingsDrafts(prev => ({ ...prev, [group]: { ...prev[group], vintage: e.target.value } }))}
                      placeholder="—"
                      className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Mgmt Fee (% p.a.)</label>
                    <input
                      type="number" step="0.01"
                      value={settingsDrafts[group]?.managementFeeRate ?? ''}
                      onChange={e => setSettingsDrafts(prev => ({ ...prev, [group]: { ...prev[group], managementFeeRate: e.target.value } }))}
                      className="border rounded px-2 py-1.5 text-sm w-full font-mono bg-transparent"
                    />
                  </div>
                </div>
                {deletingGroup === group && (
                  <div className="border border-red-200 rounded-lg p-3 space-y-2 bg-red-50 dark:bg-red-950/20">
                    <p className="text-xs text-red-700 dark:text-red-400">Type <strong>{group}</strong> to confirm deletion of all cash flows for this group.</p>
                    <input
                      type="text"
                      value={deleteConfirmName}
                      onChange={e => setDeleteConfirmName(e.target.value)}
                      placeholder={group}
                      className="border rounded px-2 py-1.5 text-sm w-full bg-transparent"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm" variant="destructive"
                        disabled={deleteConfirmName !== group || deletingGroupSaving}
                        onClick={() => handleDeleteGroup(group)}
                      >
                        {deletingGroupSaving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Delete
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setDeletingGroup(null); setDeleteConfirmName('') }}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveSettings} disabled={savingSettings}>
              {savingSettings && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PortfolioNotesPanel />
    </div>
    </PortfolioNotesProvider>
  )
}
