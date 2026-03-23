'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2, Save, X, Pencil, Briefcase, Lock, Upload, GripVertical } from 'lucide-react'
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
import { DisplayPanelButton } from '@/components/display-panel'

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
}

const DEFAULT_CONFIG: GroupConfig = {
  cashOnHand: 0,
  carryRate: 0.20,
  gpCommitPct: 0,
  vintage: null,
  managementFeeRate: 0,
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
}

const FLOW_TYPE_LABELS: Record<string, string> = {
  commitment: 'Commitment',
  called_capital: 'Called Capital',
  distribution: 'Distribution',
}

function computeTotalManagementFees(
  committed: number,
  managementFeeRate: number,
  vintage: number | null
): number {
  if (!managementFeeRate || !vintage || committed <= 0) return 0
  const currentYear = new Date().getFullYear()
  const years = Math.max(0, currentYear - vintage)
  return committed * managementFeeRate * years
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function computeFundMetrics(
  cashFlows: FundCashFlow[],
  grossResidual: number, // NAV atual das empresas (Fair Market Value)
  totalInvested: number, // Capital que efetivamente entrou nas empresas (Cost Basis)
  config: GroupConfig
): FundMetrics {
  const { cashOnHand, carryRate, gpCommitPct, vintage, managementFeeRate } = config
  
  let called = 0
  let distributions = 0
  let committed = 0

  // 1. Segregação Real dos Fluxos
  for (const cf of cashFlows) {
    if (cf.flow_type === 'called_capital') called += cf.amount
    if (cf.flow_type === 'distribution') distributions += cf.amount
    if (cf.flow_type === 'commitment') committed += cf.amount
  }

  // Ajuste de segurança: Se não lançou commitment, assume que é ao menos o que foi chamado
  const finalCommitted = committed > 0 ? committed : called
  const uncalled = Math.max(0, finalCommitted - called)

  // 2. Cálculo de Patrimônio e Carry
  const grossAssets = grossResidual + cashOnHand
  const lpCalled = called * (1 - gpCommitPct)
  const lpDistributions = distributions * (1 - gpCommitPct)
  
  // O Carry deve incidir sobre o lucro do LP após recuperar o capital chamado (Hurdle 0 aqui)
const lpBasis = Math.max(0, called - distributions)
const estimatedCarry = Math.max(0, carryRate * (grossAssets - lpBasis))
  
  const netResidual = grossAssets - estimatedCarry
  const totalValue = distributions + netResidual

  // Taxa de gestão sobre o COMPROMETIDO (Padrão de mercado no período de investimento)
  const totalManagementFees = computeTotalManagementFees(finalCommitted, managementFeeRate, vintage)

  // 3. MÉTRICAS NET (Base: CALLED - O quanto o investidor desembolsou)
  // O denominador aqui é o "cheque do investidor"
  const netTvpi = called > 0 ? totalValue / called : null
  const dpi = called > 0 ? distributions / called : null
  const rvpi = called > 0 ? netResidual / called : null
    
  // 4. MÉTRICAS GROSS (Base: INVESTED - O quanto foi para o "game")
  // O denominador aqui é o custo dos ativos
  const totalInvestedCalculation = called - totalManagementFees
  const grossMoic = totalInvestedCalculation > 0 ? (distributions + grossResidual) / totalInvestedCalculation : null
  const netMoic = totalInvestedCalculation > 0 ? totalValue / totalInvestedCalculation : null
  const grossTvpi = called > 0 ? (distributions + grossResidual) / called : null

  // 5. XIRR NET (Fluxo real do bolso do investidor) ---
  const netXirrFlows: CashFlow[] = []
  for (const cf of cashFlows) {
    if (cf.flow_type === 'called_capital') {
      netXirrFlows.push({ date: new Date(cf.flow_date), amount: -cf.amount })
    }
    if (cf.flow_type === 'distribution') {
      netXirrFlows.push({ date: new Date(cf.flow_date), amount: cf.amount })
    }
  }
  if (netResidual > 0) netXirrFlows.push({ date: new Date(), amount: netResidual })
  const netIrr = netXirrFlows.length >= 2 ? xirr(netXirrFlows) : null

  // 6. XIRR GROSS (Fluxo da tese de investimento) ---
  const grossXirrFlows: CashFlow[] = []
  // Proporção do capital que efetivamente virou investimento (ex: 0.92)
  const invRatio = called > 0 ? (totalInvested / called) : 1

  for (const cf of cashFlows) {
    if (cf.flow_type === 'called_capital') {
      // Removemos a "fricção" das taxas de cada aporte para ver o retorno puro do ativo
      grossXirrFlows.push({ date: new Date(cf.flow_date), amount: -(cf.amount * invRatio) })
    }
    if (cf.flow_type === 'distribution') {
      grossXirrFlows.push({ date: new Date(cf.flow_date), amount: cf.amount })
    }
  }
  // No Gross, usamos o Residual ANTES do Carry
  if (grossResidual > 0) grossXirrFlows.push({ date: new Date(), amount: grossResidual })
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
    netTvpi, // Repetido para compatibilidade de interface
    grossTvpi,
    totalManagementFees,
  }
}

function computeMasterFundMetrics(
  allCashFlows: FundCashFlow[],
  totalGrossResidual: number,
  totalInvested: number,
  totalCashOnHand: number,
  totalManagementFees: number,
  avgCarryRate: number,
  avgGpCommitPct: number,
): FundMetrics {
  let called = 0
  let distributions = 0

  for (const cf of allCashFlows) {
    if (cf.flow_type === 'called_capital') called += cf.amount
    if (cf.flow_type === 'distribution') distributions += cf.amount
  }

  const committed = called
  const uncalled = 0
  const grossAssets = totalGrossResidual + totalCashOnHand

  const gpCapital = called * avgGpCommitPct
  const lpCapital = called - gpCapital
  const lpDistributions = distributions * (1 - avgGpCommitPct)
  const lpRemainingCapital = lpCapital - lpDistributions
  const estimatedCarry = Math.max(0, avgCarryRate * (grossAssets * (1 - avgGpCommitPct) - lpRemainingCapital))
  const netResidual = grossAssets - estimatedCarry
  const totalValue = distributions + netResidual

  const netTvpi = called > 0 ? totalValue / called : null
  const tvpi = netTvpi
  const dpi = called > 0 ? distributions / called : null
  const rvpi = called > 0 ? netResidual / called : null

  const grossMoic = totalInvested > 0 ? (distributions + totalGrossResidual) / totalInvested : null
  const netMoicNumerator = distributions + netResidual - totalManagementFees
  const netMoic = totalInvested > 0 ? netMoicNumerator / totalInvested : null

const today2 = new Date()
const todayNorm2 = new Date(today2.getFullYear(), today2.getMonth(), today2.getDate())
const xirrFlows: CashFlow[] = []
for (const cf of allCashFlows) {
  if (cf.flow_type === 'called_capital') xirrFlows.push({ date: parseLocalDate(cf.flow_date), amount: -cf.amount })
  if (cf.flow_type === 'distribution') xirrFlows.push({ date: parseLocalDate(cf.flow_date), amount: cf.amount })
}
if (netResidual > 0) xirrFlows.push({ date: todayNorm2, amount: netResidual })
  const netIrr = xirrFlows.length >= 2 ? xirr(xirrFlows) : null

  const grossXirrFlows: CashFlow[] = []
  if (totalInvested > 0 && allCashFlows.length > 0) {
    const sorted = [...allCashFlows].sort((a, b) => a.flow_date.localeCompare(b.flow_date))
    grossXirrFlows.push({ date: new Date(sorted[0].flow_date), amount: -totalInvested })
    for (const cf of allCashFlows) {
      if (cf.flow_type === 'distribution') grossXirrFlows.push({ date: new Date(cf.flow_date), amount: cf.amount })
    }
    if (totalGrossResidual > 0) grossXirrFlows.push({ date: new Date(), amount: totalGrossResidual })
  }
  const grossIrr = grossXirrFlows.length >= 2 ? xirr(grossXirrFlows) : null
  const grossTvpi = called > 0 ? (distributions + totalGrossResidual) / called : null

  return {
    committed, called, totalInvested, distributions,
    cashOnHand: totalCashOnHand,
    grossResidual: totalGrossResidual,
    estimatedCarry, netResidual, totalValue,
    tvpi, dpi, rvpi, netIrr, grossMoic, netMoic, grossIrr, netTvpi, grossTvpi,
    totalManagementFees,
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

export default function FundsPage() {
  const fv = useFeatureVisibility()
  const currency = useCurrency()

  const [cashFlows, setCashFlows] = useState<FundCashFlow[]>([])
  const [investmentGroups, setInvestmentGroups] = useState<GroupSummaryFromInvestments[]>([])
  const [groupConfigs, setGroupConfigs] = useState<Record<string, GroupConfig>>({})
  const [loading, setLoading] = useState(true)
  const { displayUnit, setDisplayUnit } = useDisplayUnit()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ flowDate: '', flowType: '', amount: '', notes: '', portfolioGroup: '' })
  const [addingGroup, setAddingGroup] = useState<string | null>(null)
  const [addDraft, setAddDraft] = useState({ flowDate: '', flowType: 'commitment', amount: '', notes: '', portfolioGroup: '' })
  const [saving, setSaving] = useState(false)

  const [editingCashGroup, setEditingCashGroup] = useState<string | null>(null)
  const [cashOnHandDraft, setCashOnHandDraft] = useState<Record<string, string>>({})
  const [savingCash, setSavingCash] = useState(false)

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
  const [groupOrder, setGroupOrder] = useState<string[]>(() => {
  try {
    const saved = localStorage.getItem('fund-group-order')
    return saved ? JSON.parse(saved) : []
  } catch { return [] }
})
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null)
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [cfRes, invRes, gcRes] = await Promise.all([
          fetch('/api/portfolio/fund-cash-flows'),
          fetch('/api/portfolio/investments'),
          fetch('/api/portfolio/fund-group-config'),
        ])
        if (cfRes.ok) setCashFlows(await cfRes.json())
        if (invRes.ok) {
          const invData = await invRes.json()
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
            }
          }
          setGroupConfigs(map)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
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
      map.set(group, computeFundMetrics(groupFlows, grossResidual, totalInvested, config))
    }
    return map
  }, [groups, cashFlows, grossResidualByGroup, totalInvestedByGroup, groupConfigs])

  const masterMetrics = useMemo(() => {
    const totalGrossResidual = Array.from(grossResidualByGroup.values()).reduce((a, b) => a + b, 0)
    const totalInvested = Array.from(totalInvestedByGroup.values()).reduce((a, b) => a + b, 0)
    const totalCashOnHand = groups.reduce((a, g) => a + (groupConfigs[g]?.cashOnHand ?? 0), 0)

    let totalCalled = 0
    let weightedCarry = 0
    let weightedGpCommit = 0
    for (const group of groups) {
      const m = metricsByGroup.get(group)
      const config = groupConfigs[group] ?? DEFAULT_CONFIG
      if (m) {
        totalCalled += m.called
        weightedCarry += config.carryRate * m.called
        weightedGpCommit += config.gpCommitPct * m.called
      }
    }
    const avgCarryRate = totalCalled > 0 ? weightedCarry / totalCalled : 0.20
    const avgGpCommitPct = totalCalled > 0 ? weightedGpCommit / totalCalled : 0

    const totalManagementFees = groups.reduce((sum, g) => {
      const m = metricsByGroup.get(g)
      return sum + (m?.totalManagementFees ?? 0)
    }, 0)

    return computeMasterFundMetrics(
      cashFlows,
      totalGrossResidual,
      totalInvested,
      totalCashOnHand,
      totalManagementFees,
      avgCarryRate,
      avgGpCommitPct,
    )
  }, [cashFlows, groups, grossResidualByGroup, totalInvestedByGroup, groupConfigs, metricsByGroup])

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

  async function handleSaveCashOnHand(group: string) {
    setSavingCash(true)
    try {
      const res = await fetch('/api/portfolio/fund-group-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioGroup: group,
          cashOnHand: cashOnHandDraft[group] ?? (groupConfigs[group]?.cashOnHand ?? 0),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setGroupConfigs(prev => ({
          ...prev,
          [group]: { ...(prev[group] ?? DEFAULT_CONFIG), cashOnHand: Number(data.cash_on_hand) || 0 },
        }))
        setCashOnHandDraft(prev => { const next = { ...prev }; delete next[group]; return next })
        setEditingCashGroup(null)
      }
    } finally {
      setSavingCash(false)
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
              {group && editingCashGroup !== group ? (
                <button
                  onClick={() => {
                    setEditingCashGroup(group)
                    setCashOnHandDraft(prev => ({ ...prev, [group]: String(groupConfigs[group]?.cashOnHand ?? 0) }))
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              ) : group && savingCash ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : null}
            </div>
            {group && editingCashGroup === group ? (
              <input
                type="number"
                step="0.01"
                autoFocus
                value={cashOnHandDraft[group] ?? ''}
                onChange={e => setCashOnHandDraft(prev => ({ ...prev, [group]: e.target.value }))}
                onBlur={() => handleSaveCashOnHand(group)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveCashOnHand(group); if (e.key === 'Escape') setEditingCashGroup(null) }}
                placeholder="0"
                className="border rounded px-1.5 py-0.5 text-lg font-semibold w-full font-mono bg-transparent"
              />
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

  if (loading) {
    return (
      <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2 mb-6">
          {fv.funds === 'admin' && <Lock className="h-4 w-4 text-amber-500" />}Funds
        </h1>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />Loading...
        </div>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2 mb-6">
          {fv.funds === 'admin' && <Lock className="h-4 w-4 text-amber-500" />}Funds
        </h1>
        <p className="text-sm text-muted-foreground">
          No fund cash flows yet. Add cash flows from the Import page or from individual group tabs.
        </p>
      </div>
    )
  }

  return (
    <PortfolioNotesProvider pageContext="funds">
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <div className="mb-6 space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            {fv.funds === 'admin' && <Lock className="h-4 w-4 text-amber-500" />}Funds
          </h1>
          <span className="flex items-center gap-2">
            <DisplayPanelButton />
            <PortfolioNotesButton />
            <AnalystToggleButton />
          </span>
        </div>
        <p className="text-sm text-muted-foreground">Fund-level cash flows, NAV, and performance metrics</p>
      </div>

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
            .filter(cf => cf.portfolio_group === group)
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

              <MetricCards metrics={metrics} group={group} />

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
                      <th className="px-3 py-2 w-20 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupFlows.map((cf, idx) => {
                      const cumul = rowCumulatives[idx]
                      const isEditing = editingId === cf.id

                      if (isEditing) {
                        return (
                          <tr key={cf.id} className="border-b last:border-b-0 bg-blue-50/50 dark:bg-blue-950/20">
                            <td className="px-3 py-1.5">
                              <input type="date" value={editDraft.flowDate} onChange={e => setEditDraft(d => ({ ...d, flowDate: e.target.value }))} className="border rounded px-1.5 py-0.5 text-sm w-32" />
                            </td>
                            <td className="px-3 py-1.5">
                              <select value={editDraft.flowType} onChange={e => setEditDraft(d => ({ ...d, flowType: e.target.value }))} className="border rounded px-1.5 py-0.5 text-sm">
                                <option value="commitment">Commitment</option>
                                <option value="called_capital">Called Capital</option>
                                <option value="distribution">Distribution</option>
                              </select>
                            </td>
                            <td className="px-3 py-1.5">
                              <input type="text" value={editDraft.portfolioGroup} onChange={e => setEditDraft(d => ({ ...d, portfolioGroup: e.target.value }))} className="border rounded px-1.5 py-0.5 text-sm w-28" />
                            </td>
                            <td className="px-3 py-1.5">
                              <input type="number" step="0.01" value={editDraft.amount} onChange={e => setEditDraft(d => ({ ...d, amount: e.target.value }))} className="border rounded px-1.5 py-0.5 text-sm text-right w-28" />
                            </td>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" className="text-muted-foreground h-7 px-2 text-xs" onClick={handleSaveEdit} disabled={saving}>
                                  <Save className="h-3.5 w-3.5 mr-1" />Save
                                </Button>
                                <Button variant="outline" size="sm" className="text-muted-foreground h-7 px-2 text-xs" onClick={() => setEditingId(null)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                            <td colSpan={4} />
                          </tr>
                        )
                      }

                      return (
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
                          <td className="px-3 py-2 text-right font-mono">{fmt(cumul.called)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(cumul.distributed)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <button onClick={() => startEdit(cf)} className="text-muted-foreground hover:text-foreground" title="Edit">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => handleDelete(cf.id)} className="text-muted-foreground hover:text-red-600" title="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}

                    {addingGroup === group && (
                      <tr className="border-b last:border-b-0 bg-green-50/50 dark:bg-green-950/20">
                        <td className="px-3 py-1.5">
                          <input type="date" value={addDraft.flowDate} onChange={e => setAddDraft(d => ({ ...d, flowDate: e.target.value }))} className="border rounded px-1.5 py-0.5 text-sm w-32" />
                        </td>
                        <td className="px-3 py-1.5">
                          <select value={addDraft.flowType} onChange={e => setAddDraft(d => ({ ...d, flowType: e.target.value }))} className="border rounded px-1.5 py-0.5 text-sm">
                            <option value="commitment">Commitment</option>
                            <option value="called_capital">Called Capital</option>
                            <option value="distribution">Distribution</option>
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <input type="text" value={addDraft.portfolioGroup} onChange={e => setAddDraft(d => ({ ...d, portfolioGroup: e.target.value }))} className="border rounded px-1.5 py-0.5 text-sm w-28" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input type="number" step="0.01" value={addDraft.amount} onChange={e => setAddDraft(d => ({ ...d, amount: e.target.value }))} className="border rounded px-1.5 py-0.5 text-sm text-right w-28" placeholder="0.00" />
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" className="text-muted-foreground h-7 px-2 text-xs" onClick={() => handleAdd(addDraft.portfolioGroup || group)} disabled={saving || !addDraft.flowDate || !addDraft.amount}>
                              <Save className="h-3.5 w-3.5 mr-1" />Save
                            </Button>
                            <Button variant="outline" size="sm" className="text-muted-foreground h-7 px-2 text-xs" onClick={() => { setAddingGroup(null); setAddDraft({ flowDate: '', flowType: 'commitment', amount: '', notes: '', portfolioGroup: '' }) }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                        <td colSpan={4} />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {addingGroup !== group && (
                <div className="flex items-center gap-2 mt-3">
                  <Button variant="outline" size="sm" className="text-muted-foreground" onClick={() => { setAddingGroup(group); setAddDraft({ flowDate: '', flowType: 'commitment', amount: '', notes: '', portfolioGroup: group }) }}>
                    <Plus className="h-4 w-4 mr-1" />Add Cash Flow
                  </Button>
                  <Button variant="outline" size="sm" className="text-muted-foreground" onClick={() => { setImportOpen(!importOpen); setImportResult(null) }}>
                    <Upload className="h-4 w-4 mr-1" />Import
                  </Button>
                </div>
              )}

              {importOpen && (
                <div className="mt-4 border rounded-lg p-4">
                  <p className="text-sm text-muted-foreground mb-2">
                    Paste fund cash flow data from a spreadsheet.
                  </p>
                  <textarea
                    value={importData}
                    onChange={e => setImportData(e.target.value)}
                    rows={6}
                    className="w-full border border-input rounded p-2 text-sm font-mono bg-transparent text-foreground mb-2"
                    placeholder="Paste any fund cash flow data here"
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={handleImport} disabled={importing || !importData.trim()}>
                      {importing ? 'Importing...' : 'Import'}
                    </Button>
                    {importResult && (
                      <span className={`text-sm ${importResult.created === 0 && importResult.errors.length > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {importResult.created > 0 && `${importResult.created} cash flow${importResult.created !== 1 ? 's' : ''} imported.`}
                        {importResult.errors.length > 0 && ` ${importResult.errors.length} error${importResult.errors.length !== 1 ? 's' : ''}: ${importResult.errors[0]}`}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          )
        })}
      </Tabs>
      </div>
      <PortfolioNotesPanel />
      <AnalystPanel />
      </div>

      <Dialog open={settingsOpen} onOpenChange={open => { if (!open) setSettingsOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fund Settings</DialogTitle>
            <DialogDescription>Configure fees and settings per portfolio group. Drag to reorder.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2 max-h-[60vh] overflow-y-auto">
            {orderedGroups.map(group => (
              <div
                key={group}
                draggable
                onDragStart={() => handleDragStart(group)}
                onDragOver={e => handleDragOver(e, group)}
                onDrop={() => handleDrop(group)}
                onDragEnd={() => { setDraggedGroup(null); setDragOverGroup(null) }}
                className={`space-y-3 rounded-lg transition-all ${
                  dragOverGroup === group && draggedGroup !== group
                    ? 'border-2 border-blue-400 p-2'
                    : draggedGroup === group
                    ? 'opacity-40'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between border-b pb-1">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                    <h3 className="text-sm font-semibold">{group}</h3>
                  </div>
                  <button
                    onClick={() => { setDeletingGroup(group); setDeleteConfirmName('') }}
                    className="text-muted-foreground hover:text-red-600"
                    title="Delete fund"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Vintage</label>
                    <input type="number" step="1" min="1900" max="2100" value={settingsDrafts[group]?.vintage ?? ''} onChange={e => setSettingsDrafts(prev => ({ ...prev, [group]: { ...prev[group], vintage: e.target.value } }))} placeholder="2024" className="border rounded px-2 py-1.5 text-sm w-full font-mono" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Carry Rate (%)</label>
                    <input type="number" step="0.1" value={settingsDrafts[group]?.carryRate ?? '20'} onChange={e => setSettingsDrafts(prev => ({ ...prev, [group]: { ...prev[group], carryRate: e.target.value } }))} placeholder="20" className="border rounded px-2 py-1.5 text-sm w-full font-mono" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">GP Commit (%)</label>
                    <input type="number" step="0.1" value={settingsDrafts[group]?.gpCommitPct ?? '0'} onChange={e => setSettingsDrafts(prev => ({ ...prev, [group]: { ...prev[group], gpCommitPct: e.target.value } }))} placeholder="0" className="border rounded px-2 py-1.5 text-sm w-full font-mono" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Management Fee (% p.a.)</label>
                    <input type="number" step="0.1" value={settingsDrafts[group]?.managementFeeRate ?? '0'} onChange={e => setSettingsDrafts(prev => ({ ...prev, [group]: { ...prev[group], managementFeeRate: e.target.value } }))} placeholder="2" className="border rounded px-2 py-1.5 text-sm w-full font-mono" />
                  </div>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Management fee is calculated annually on committed capital from vintage year.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveSettings} disabled={savingSettings}>
              {savingSettings && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingGroup} onOpenChange={open => { if (!open) { setDeletingGroup(null); setDeleteConfirmName('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Fund</DialogTitle>
            <DialogDescription>
              This will permanently delete all cash flows for <strong>{deletingGroup}</strong>. Type the fund name to confirm.
            </DialogDescription>
          </DialogHeader>
          <input
            type="text"
            value={deleteConfirmName}
            onChange={e => setDeleteConfirmName(e.target.value)}
            placeholder={deletingGroup ?? ''}
            className="border rounded px-2 py-1.5 text-sm w-full"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeletingGroup(null); setDeleteConfirmName('') }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmName !== deletingGroup || deletingGroupSaving}
              onClick={() => deletingGroup && handleDeleteGroup(deletingGroup)}
            >
              {deletingGroupSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </PortfolioNotesProvider>
  )
}
