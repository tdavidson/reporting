'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Loader2, Upload, Download, ChevronDown, ChevronRight, Trash2, Users, X, Check, Pencil, FileText, Settings, Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useCurrency, formatCurrency } from '@/components/currency-context'
import { PortfolioGroupFilter } from '@/components/lp-portfolio-group-filter'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Snapshot {
  id: string
  name: string
  as_of_date: string | null
  created_at: string
  description: string | null
  footer_note: string | null
  associates_calc_enabled: boolean | null
}

interface LpInvestor {
  id: string
  name: string
  parent_id: string | null
}

interface LpInvestment {
  id: string
  entity_id: string
  portfolio_group: string
  commitment: number | null
  total_value: number | null
  nav: number | null
  called_capital: number | null
  paid_in_capital: number | null
  distributions: number | null
  outstanding_balance: number | null
  dpi: number | null
  rvpi: number | null
  tvpi: number | null
  irr: number | null
  input_commitment: number | null
  input_paid_in_capital: number | null
  input_distributions: number | null
  input_nav: number | null
  input_total_value: number | null
  lp_entities: {
    id: string
    entity_name: string
    investor_id: string
    lp_investors: { id: string; name: string }
  }
}

interface Aggregated {
  commitment: number
  paidInCapital: number
  distributions: number
  unrealizedValue: number
  totalValue: number
  pctFunded: number | null
  dpi: number | null
  rvpi: number | null
  tvpi: number | null
  irr: number | null
  importedRvpi: number | null
  importedTvpi: number | null
}

interface InvestorNode extends Aggregated {
  investorId: string
  investorName: string
  investments: LpInvestment[]
  children?: InvestorNode[]
  isGroup?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtMoic(val: number | null): string {
  if (val == null) return '-'
  return `${val.toFixed(2)}x`
}

function fmtImported(imported: number | null, calculated: number | null): { text: string; deviated: boolean } {
  if (imported == null) return { text: '-', deviated: false }
  const text = `${imported.toFixed(2)}x`
  if (calculated == null) return { text, deviated: false }
  const diff = Math.abs(imported - calculated)
  return { text, deviated: diff > 0.005 }
}

function fmtPct(val: number | null): string {
  if (val == null) return '-'
  return `${(val * 100).toFixed(1)}%`
}

function aggregate(invs: LpInvestment[]): Aggregated {
  let commitment = 0, paidInCapital = 0, distributions = 0, unrealizedValue = 0

  for (const inv of invs) {
    commitment += Number(inv.commitment) || 0
    paidInCapital += Number(inv.paid_in_capital) || Number(inv.called_capital) || 0
    distributions += Number(inv.distributions) || 0
    unrealizedValue += Number(inv.nav) || 0
  }

  const totalValue = distributions + unrealizedValue
  const pctFunded = commitment > 0 ? paidInCapital / commitment : null
  const dpi = paidInCapital > 0 ? distributions / paidInCapital : null
  const rvpi = paidInCapital > 0 ? unrealizedValue / paidInCapital : null
  const tvpi = dpi != null && rvpi != null ? dpi + rvpi : null
  const irr = invs.length === 1 && invs[0].irr != null ? Number(invs[0].irr) : null
  const importedRvpi = invs.length === 1 && invs[0].rvpi != null ? Number(invs[0].rvpi) : null
  const importedTvpi = invs.length === 1 && invs[0].tvpi != null ? Number(invs[0].tvpi) : null

  return {
    commitment, paidInCapital, distributions, unrealizedValue, totalValue,
    pctFunded, dpi, rvpi, tvpi, irr, importedRvpi, importedTvpi,
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SnapshotDetailPage() {
  const currency = useCurrency()
  const router = useRouter()
  const params = useParams()
  const snapshotId = params.snapshotId as string
  const fmt = (val: number) => formatCurrency(val, currency)

  // Snapshot metadata
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  // Detail state
  const [investors, setInvestors] = useState<LpInvestor[]>([])
  const [investments, setInvestments] = useState<LpInvestment[]>([])
  const [loadingDetail, setLoadingDetail] = useState(true)

  // Import
  const [importOpen, setImportOpen] = useState(false)
  const [importData, setImportData] = useState('')
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null)
  const [importing, setImporting] = useState(false)

  // Expanded rows
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Inline editing
  const [editingInvestmentId, setEditingInvestmentId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Record<string, any>>({})
  const [editingInvestorId, setEditingInvestorId] = useState<string | null>(null)
  const [editInvestorName, setEditInvestorName] = useState('')

  // Grouping dialog
  const [groupingInvestorId, setGroupingInvestorId] = useState<string | null>(null)
  const [groupingInvestorName, setGroupingInvestorName] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [groupSearch, setGroupSearch] = useState('')

  // Excel export
  const [exporting, setExporting] = useState(false)

  // Snapshot description & footer note
  const [description, setDescription] = useState('')
  const [savingDescription, setSavingDescription] = useState(false)
  const descriptionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [footerNote, setFooterNote] = useState('')
  const [savingFooterNote, setSavingFooterNote] = useState(false)
  const footerNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // GP entity overrides (for excluding GP entities from totals)
  const [assocOverrides, setAssocOverrides] = useState<any[]>([])

  // Portfolio group filter
  const [excludedGroups, setExcludedGroups] = useState<Set<string>>(new Set())

  // Report settings modal
  const [reportSettingsOpen, setReportSettingsOpen] = useState(false)

  // Search
  const [searchQuery, setSearchQuery] = useState('')

  // Sort
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  // ----- Load data -----
  async function loadDetail() {
    setLoadingDetail(true)
    try {
      const [snapRes, invRes, investmentRes] = await Promise.all([
        fetch(`/api/lps/snapshots`),
        fetch('/api/lps/investors'),
        fetch(`/api/lps/investments?snapshotId=${snapshotId}`),
      ])
      if (snapRes.ok) {
        const snaps: Snapshot[] = await snapRes.json()
        const snap = snaps.find(s => s.id === snapshotId) ?? null
        setSnapshot(snap)
        setDescription(snap?.description ?? '')
        setFooterNote(snap?.footer_note ?? '')
      }
      if (invRes.ok) setInvestors(await invRes.json())
      if (investmentRes.ok) setInvestments(await investmentRes.json())
    } finally {
      setLoadingDetail(false)
    }
  }

  async function loadOverrides() {
    try {
      const res = await fetch('/api/lps/associates-overrides')
      if (res.ok) setAssocOverrides(await res.json())
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadDetail()
    loadOverrides()
  }, [snapshotId])

  // When associates calc is disabled, swap to input (original imported) values for display
  const useInputValues = snapshot?.associates_calc_enabled === false

  const effectiveInvestments = useMemo(() => {
    if (!useInputValues) return investments
    return investments.map(inv => {
      // Only swap if input values exist (meaning the calc has run on this row before)
      if (inv.input_commitment == null && inv.input_nav == null && inv.input_paid_in_capital == null) return inv
      return {
        ...inv,
        commitment: inv.input_commitment ?? inv.commitment,
        paid_in_capital: inv.input_paid_in_capital ?? inv.paid_in_capital,
        distributions: inv.input_distributions ?? inv.distributions,
        nav: inv.input_nav ?? inv.nav,
        total_value: inv.input_total_value ?? inv.total_value,
      }
    })
  }, [investments, useInputValues])

  // ----- Build investor rows (with parent-child grouping) -----
  const investorTree = useMemo(() => {
    const investmentsByInvestor = new Map<string, { name: string; investments: LpInvestment[] }>()
    for (const inv of effectiveInvestments) {
      const investorId = inv.lp_entities?.lp_investors?.id
      const investorName = inv.lp_entities?.lp_investors?.name
      if (!investorId || !investorName) continue
      const entry = investmentsByInvestor.get(investorId) ?? { name: investorName, investments: [] }
      entry.investments.push(inv)
      investmentsByInvestor.set(investorId, entry)
    }

    const investorMap = new Map<string, LpInvestor>()
    for (const inv of investors) investorMap.set(inv.id, inv)

    const childrenOf = new Map<string, string[]>()
    for (const inv of investors) {
      if (inv.parent_id) {
        const siblings = childrenOf.get(inv.parent_id) ?? []
        siblings.push(inv.id)
        childrenOf.set(inv.parent_id, siblings)
      }
    }

    function buildNode(investorId: string): InvestorNode | null {
      const entry = investmentsByInvestor.get(investorId)
      const investor = investorMap.get(investorId)
      const childIds = childrenOf.get(investorId) ?? []

      if (childIds.length > 0) {
        const children: InvestorNode[] = []
        const allInvestments: LpInvestment[] = []
        for (const childId of childIds) {
          const childNode = buildNode(childId)
          if (childNode) {
            children.push(childNode)
            allInvestments.push(...childNode.investments)
          }
        }
        if (entry) {
          allInvestments.push(...entry.investments)
          const parentAgg = aggregate(entry.investments)
          children.push({
            investorId: investorId + '-own',
            investorName: investor?.name ?? entry.name,
            investments: entry.investments,
            ...parentAgg,
          })
        }
        if (children.length === 0) return null
        const agg = aggregate(allInvestments)
        return {
          investorId,
          investorName: investor?.name ?? entry?.name ?? '',
          investments: allInvestments,
          children: children.sort((a, b) => a.investorName.localeCompare(b.investorName)),
          isGroup: true,
          ...agg,
        }
      }

      if (!entry) return null
      const agg = aggregate(entry.investments)
      return { investorId, investorName: entry.name, investments: entry.investments, ...agg }
    }

    const rows: InvestorNode[] = []
    for (const inv of investors) {
      if (!inv.parent_id) {
        const node = buildNode(inv.id)
        if (node) rows.push(node)
      }
    }

    const seen = new Set(investors.map(i => i.id))
    for (const investorId of Array.from(investmentsByInvestor.keys())) {
      if (!seen.has(investorId)) {
        const entry = investmentsByInvestor.get(investorId)!
        const agg = aggregate(entry.investments)
        rows.push({ investorId, investorName: entry.name, investments: entry.investments, ...agg })
      }
    }

    return rows.sort((a, b) => a.investorName.localeCompare(b.investorName))
  }, [effectiveInvestments, investors])

  // All unique portfolio groups for filter
  const allGroups = useMemo(() => {
    const groups = new Set<string>()
    for (const inv of effectiveInvestments) {
      if (inv.portfolio_group) groups.add(inv.portfolio_group)
    }
    return Array.from(groups).sort()
  }, [effectiveInvestments])

  // Filtered investor tree
  const filteredInvestorTree = useMemo(() => {
    if (excludedGroups.size === 0) return investorTree
    function filterNode(node: InvestorNode): InvestorNode | null {
      const filteredInvs = node.investments.filter(inv => !excludedGroups.has(inv.portfolio_group))
      if (filteredInvs.length === 0) return null
      const agg = aggregate(filteredInvs)
      const children = node.children
        ? node.children.map(c => filterNode(c)).filter(Boolean) as InvestorNode[]
        : undefined
      return { ...node, investments: filteredInvs, children: children && children.length > 0 ? children : undefined, ...agg }
    }
    return investorTree.map(n => filterNode(n)).filter(Boolean) as InvestorNode[]
  }, [investorTree, excludedGroups])

  // Search + sort the filtered tree (top-level only)
  const searchedAndSortedTree = useMemo(() => {
    let result = filteredInvestorTree

    // Search filter: match investor name or entity names
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(node => {
        if (node.investorName.toLowerCase().includes(q)) return true
        return node.investments.some(inv =>
          inv.lp_entities?.entity_name?.toLowerCase().includes(q)
        )
      })
    }

    // Sort (top-level only)
    if (sortColumn) {
      const dir = sortDirection === 'asc' ? 1 : -1
      result = [...result].sort((a, b) => {
        let av: any, bv: any
        switch (sortColumn) {
          case 'investor': av = a.investorName.toLowerCase(); bv = b.investorName.toLowerCase(); break
          case 'commitment': av = a.commitment; bv = b.commitment; break
          case 'paidInCapital': av = a.paidInCapital; bv = b.paidInCapital; break
          case 'distributions': av = a.distributions; bv = b.distributions; break
          case 'unrealizedValue': av = a.unrealizedValue; bv = b.unrealizedValue; break
          case 'totalValue': av = a.totalValue; bv = b.totalValue; break
          case 'pctFunded': av = a.pctFunded ?? -Infinity; bv = b.pctFunded ?? -Infinity; break
          case 'dpi': av = a.dpi ?? -Infinity; bv = b.dpi ?? -Infinity; break
          case 'rvpi': av = a.rvpi ?? -Infinity; bv = b.rvpi ?? -Infinity; break
          case 'tvpi': av = a.tvpi ?? -Infinity; bv = b.tvpi ?? -Infinity; break
          case 'irr': av = a.irr ?? -Infinity; bv = b.irr ?? -Infinity; break
          default: return 0
        }
        if (av < bv) return -1 * dir
        if (av > bv) return 1 * dir
        return 0
      })
    }

    return result
  }, [filteredInvestorTree, searchQuery, sortColumn, sortDirection])

  function handleSort(col: string) {
    if (sortColumn === col) {
      if (sortDirection === 'asc') setSortDirection('desc')
      else { setSortColumn(null); setSortDirection('asc') }
    } else {
      setSortColumn(col)
      setSortDirection(col === 'investor' ? 'asc' : 'desc')
    }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortColumn !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-0 group-hover/th:opacity-50 inline" />
    if (sortDirection === 'asc') return <ArrowUp className="h-3 w-3 ml-1 inline" />
    return <ArrowDown className="h-3 w-3 ml-1 inline" />
  }

  // Associates entity names (normalized) — these are GP vehicles whose value is
  // already reflected in individual investors' pro-rata shares, so we exclude
  // them from totals to avoid double-counting.
  const assocEntityNames = useMemo(() => {
    const norm = (s: string) => s.replace(/,/g, '').toLowerCase().trim()
    const names = new Set<string>()
    for (const ov of assocOverrides) {
      if (ov.associates_entity) names.add(norm(ov.associates_entity))
    }
    return names
  }, [assocOverrides])

  // Filtered totals (excluding GP entity investors to avoid double-counting)
  const filteredTotals = useMemo(() => {
    const norm = (s: string) => s.replace(/,/g, '').toLowerCase().trim()
    let commitment = 0, paidInCapital = 0, distributions = 0, unrealizedValue = 0
    let investorCount = 0
    for (const r of searchedAndSortedTree) {
      if (assocEntityNames.has(norm(r.investorName))) continue
      commitment += r.commitment
      paidInCapital += r.paidInCapital
      distributions += r.distributions
      unrealizedValue += r.unrealizedValue
      investorCount++
    }
    const totalValue = distributions + unrealizedValue
    return {
      commitment, paidInCapital, distributions, unrealizedValue, totalValue,
      pctFunded: commitment > 0 ? paidInCapital / commitment : null,
      dpi: paidInCapital > 0 ? distributions / paidInCapital : null,
      rvpi: paidInCapital > 0 ? unrealizedValue / paidInCapital : null,
      tvpi: paidInCapital > 0 ? totalValue / paidInCapital : null,
      investorCount,
    }
  }, [searchedAndSortedTree, assocEntityNames])

  const groupTargets = useMemo(() => {
    return investors.sort((a, b) => a.name.localeCompare(b.name))
  }, [investors])

  // ----- Handlers -----

  function handleDescriptionChange(value: string) {
    setDescription(value)
    setSnapshot(prev => prev ? { ...prev, description: value } : prev)
    if (descriptionTimer.current) clearTimeout(descriptionTimer.current)
    descriptionTimer.current = setTimeout(() => {
      setSavingDescription(true)
      fetch('/api/lps/snapshots', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: snapshotId, description: value }),
      }).finally(() => setSavingDescription(false))
    }, 1000)
  }

  function handleFooterNoteChange(value: string) {
    setFooterNote(value)
    setSnapshot(prev => prev ? { ...prev, footer_note: value } : prev)
    if (footerNoteTimer.current) clearTimeout(footerNoteTimer.current)
    footerNoteTimer.current = setTimeout(() => {
      setSavingFooterNote(true)
      fetch('/api/lps/snapshots', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: snapshotId, footerNote: value }),
      }).finally(() => setSavingFooterNote(false))
    }, 1000)
  }

  async function handleImport() {
    if (!importData.trim()) return
    setImporting(true)
    setImportResult(null)
    try {
      const res = await fetch('/api/lps/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: importData, snapshotId }),
      })
      const result = await res.json()
      if (res.ok) {
        setImportResult(result)
        setImportData('')
        loadDetail()
      } else {
        setImportResult({ created: 0, updated: 0, errors: [result.error || 'Import failed'] })
      }
    } finally {
      setImporting(false)
    }
  }

  async function handleDeleteInvestment(id: string) {
    if (!confirm('Delete this investment?')) return
    await fetch(`/api/lps/investments?id=${id}`, { method: 'DELETE' })
    loadDetail()
  }

  async function handleExportExcel() {
    setExporting(true)
    try {
      const res = await fetch('/api/lps/export/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `lp-report-${snapshot?.name || 'export'}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      }
    } finally {
      setExporting(false)
    }
  }

  // --- Inline editing ---

  function startEditInvestment(inv: LpInvestment) {
    setEditingInvestmentId(inv.id)
    setEditDraft({
      entity_name: inv.lp_entities?.entity_name ?? '',
      portfolio_group: inv.portfolio_group,
      commitment: inv.commitment,
      paid_in_capital: inv.paid_in_capital,
      distributions: inv.distributions,
      nav: inv.nav,
      total_value: inv.total_value,
      irr: inv.irr,
    })
  }

  async function saveEditInvestment() {
    if (!editingInvestmentId) return
    const res = await fetch('/api/lps/investments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingInvestmentId,
        portfolioGroup: editDraft.portfolio_group,
        commitment: editDraft.commitment,
        paidInCapital: editDraft.paid_in_capital,
        distributions: editDraft.distributions,
        nav: editDraft.nav,
        totalValue: editDraft.total_value,
        irr: editDraft.irr,
      }),
    })
    if (res.ok) {
      setEditingInvestmentId(null)
      loadDetail()
    }
  }

  function cancelEdit() {
    setEditingInvestmentId(null)
    setEditDraft({})
    setEditingInvestorId(null)
    setEditInvestorName('')
  }

  function startEditInvestorName(investorId: string, name: string) {
    setEditingInvestorId(investorId)
    setEditInvestorName(name)
  }

  async function saveInvestorName() {
    const id = editingInvestorId
    const name = editInvestorName.trim()
    if (!id || !name) return
    setEditingInvestorId(null)
    setEditInvestorName('')
    const res = await fetch('/api/lps/investors', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    })
    if (!res.ok) {
      if (res.status === 409) {
        const target = investors.find(inv => inv.name.toLowerCase() === name.toLowerCase() && inv.id !== id)
        if (target) {
          await fetch('/api/lps/investors', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceId: id, targetId: target.id }),
          })
          loadDetail()
          return
        }
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to save' }))
        alert(err.error || 'Failed to save investor name')
      }
    }
    loadDetail()
  }

  // --- Grouping ---

  function openGroupDialog(investorId: string, investorName: string) {
    setGroupingInvestorId(investorId)
    setGroupingInvestorName(investorName)
    setNewGroupName('')
    setGroupSearch('')
  }

  async function groupInvestor(sourceId: string, targetId: string) {
    const targetInvestor = investors.find(i => i.id === targetId)
    if (!targetInvestor) return

    const isGroupParent = investors.some(i => i.parent_id === targetId)

    if (isGroupParent) {
      await fetch('/api/lps/investors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sourceId, parentId: targetId }),
      })
    } else if (targetInvestor.parent_id) {
      await fetch('/api/lps/investors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sourceId, parentId: targetInvestor.parent_id }),
      })
    } else {
      await fetch('/api/lps/investors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sourceId, parentId: targetId }),
      })
    }

    setGroupingInvestorId(null)
    loadDetail()
  }

  async function createGroupAndMerge() {
    if (!newGroupName.trim() || !groupingInvestorId) return
    const res = await fetch('/api/lps/investors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGroupName.trim() }),
    })
    if (res.ok) {
      const newParent = await res.json()
      await fetch('/api/lps/investors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: groupingInvestorId, parentId: newParent.id }),
      })
      setGroupingInvestorId(null)
      loadDetail()
    }
    setNewGroupName('')
  }

  async function ungroupInvestor(investorId: string) {
    await fetch('/api/lps/investors', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: investorId, parentId: null }),
    })
    loadDetail()
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      {/* Header row 1: title + analyst */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {snapshot?.name ?? 'Loading...'}
        </h1>
        <AnalystToggleButton />
      </div>

      {/* Header row 2: search, filters, actions */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search investors..."
            className="w-40 md:w-56 border border-input rounded pl-7 pr-2 py-1.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {allGroups.length > 1 && (
          <PortfolioGroupFilter
            allGroups={allGroups}
            excludedGroups={excludedGroups}
            onToggle={(group) => setExcludedGroups(prev => {
              const next = new Set(prev)
              if (next.has(group)) next.delete(group); else next.add(group)
              return next
            })}
            onToggleAll={() => setExcludedGroups(prev =>
              prev.size === 0 ? new Set(allGroups) : new Set()
            )}
          />
        )}
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => { setImportOpen(!importOpen); setImportResult(null) }}>
          <Upload className="h-4 w-4 mr-1" />
          Import
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={exporting || investorTree.length === 0}>
          <Download className="h-4 w-4 mr-1" />
          {exporting ? 'Exporting...' : 'Export Excel'}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={`/lps/${snapshotId}/batch`}>
            <FileText className="h-4 w-4 mr-1" />
            Batch PDFs
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={() => setReportSettingsOpen(true)}>
          <Settings className="h-4 w-4 mr-1" />
          Settings
        </Button>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0 w-full">

      {/* Import Section */}
      {importOpen && (
        <div className="mb-6 border rounded-lg p-4">
          <p className="text-sm text-muted-foreground mb-2">
            Paste spreadsheet data in any format. AI will match columns for investor name, fund/vehicle, commitment, paid-in capital, distributions, NAV, DPI, RVPI, TVPI, IRR, and more.
          </p>
          <textarea
            value={importData}
            onChange={e => setImportData(e.target.value)}
            rows={6}
            className="w-full border border-input rounded p-2 text-sm font-mono bg-transparent text-foreground mb-2"
            placeholder="Paste any LP data here — columns will be matched automatically"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleImport} disabled={importing || !importData.trim()}>
              {importing ? 'Importing...' : 'Import'}
            </Button>
            {importResult && (
              <span className={`text-sm ${importResult.created === 0 && importResult.updated === 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                {importResult.created === 0 && importResult.updated === 0
                  ? 'No investors imported'
                  : `${importResult.created} created, ${importResult.updated} updated`}
                {importResult.errors.length > 0 && ` (${importResult.errors.length} errors)`}
              </span>
            )}
          </div>
          {importResult?.errors && importResult.errors.length > 0 && (
            <div className="mt-2 text-sm text-red-600 space-y-0.5">
              {importResult.errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loadingDetail ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      ) : investorTree.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">No investment data in this snapshot yet. Import spreadsheet data to get started.</p>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-1" />
            Import Data
          </Button>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground mb-1">Total Commitment</p>
                <p className="text-xl font-semibold">{fmt(filteredTotals.commitment)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground mb-1">Total Paid-In Capital</p>
                <p className="text-xl font-semibold">{fmt(filteredTotals.paidInCapital)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground mb-1">Total Distributions</p>
                <p className="text-xl font-semibold">{fmt(filteredTotals.distributions)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground mb-1">TVPI</p>
                <p className="text-xl font-semibold">{fmtMoic(filteredTotals.tvpi)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Investor Table */}
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b bg-muted">
                  <th className="text-left px-3 py-2 font-medium sticky left-0 bg-muted z-10 min-w-[180px] cursor-pointer select-none group/th" onClick={() => handleSort('investor')}>Investor<SortIcon col="investor" /></th>
                  <th className="text-right px-3 py-2 font-medium cursor-pointer select-none group/th" onClick={() => handleSort('commitment')}>Commitment<SortIcon col="commitment" /></th>
                  <th className="text-right px-3 py-2 font-medium cursor-pointer select-none group/th" onClick={() => handleSort('paidInCapital')}>Paid-in Capital<SortIcon col="paidInCapital" /></th>
                  <th className="text-right px-3 py-2 font-medium cursor-pointer select-none group/th" onClick={() => handleSort('distributions')}>Distributions<SortIcon col="distributions" /></th>
                  <th className="text-right px-3 py-2 font-medium cursor-pointer select-none group/th" onClick={() => handleSort('unrealizedValue')}>Net Asset Balance<SortIcon col="unrealizedValue" /></th>
                  <th className="text-right px-3 py-2 font-medium cursor-pointer select-none group/th" onClick={() => handleSort('totalValue')}>Total Value<SortIcon col="totalValue" /></th>
                  <th className="text-right px-3 py-2 font-medium cursor-pointer select-none group/th" onClick={() => handleSort('pctFunded')}>% Funded<SortIcon col="pctFunded" /></th>
                  <th className="text-right px-3 py-2 font-medium cursor-pointer select-none group/th" onClick={() => handleSort('dpi')}>DPI<SortIcon col="dpi" /></th>
                  <th className="text-right px-3 py-2 font-medium cursor-pointer select-none group/th" onClick={() => handleSort('rvpi')}>RVPI<SortIcon col="rvpi" /></th>
                  <th className="text-right px-3 py-2 font-medium cursor-pointer select-none group/th" onClick={() => handleSort('tvpi')}>TVPI<SortIcon col="tvpi" /></th>
                  <th className="text-right px-3 py-2 font-medium cursor-pointer select-none group/th" onClick={() => handleSort('irr')}>IRR<SortIcon col="irr" /></th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground/60 text-xs">Imp. RVPI</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground/60 text-xs">Imp. TVPI</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {searchedAndSortedTree.map(node => (
                  <InvestorTreeRows
                    key={node.investorId}
                    node={node}
                    expanded={expanded}
                    onToggle={toggleExpand}
                    onDeleteInvestment={handleDeleteInvestment}
                    fmt={fmt}
                    editingInvestmentId={editingInvestmentId}
                    editDraft={editDraft}
                    setEditDraft={setEditDraft}
                    onStartEditInvestment={startEditInvestment}
                    onSaveEditInvestment={saveEditInvestment}
                    onCancelEdit={cancelEdit}
                    editingInvestorId={editingInvestorId}
                    editInvestorName={editInvestorName}
                    setEditInvestorName={setEditInvestorName}
                    onStartEditInvestorName={startEditInvestorName}
                    onSaveInvestorName={saveInvestorName}
                    onOpenGroupDialog={openGroupDialog}
                    onUngroupInvestor={ungroupInvestor}
                    snapshotId={snapshotId}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted font-medium">
                  <td className="px-3 py-2 sticky left-0 bg-muted z-10">Total ({filteredTotals.investorCount} investors)</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(filteredTotals.commitment)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(filteredTotals.paidInCapital)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(filteredTotals.distributions)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(filteredTotals.unrealizedValue)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(filteredTotals.totalValue)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtPct(filteredTotals.pctFunded)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtMoic(filteredTotals.dpi)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtMoic(filteredTotals.rvpi)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtMoic(filteredTotals.tvpi)}</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      </div>
      <AnalystPanel />
      </div>

      {/* Grouping Dialog */}
      <Dialog open={!!groupingInvestorId} onOpenChange={open => { if (!open) setGroupingInvestorId(null) }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>Group Investor</DialogTitle>
            <DialogDescription>
              <span className="block break-all">Group &ldquo;<span className="font-medium">{groupingInvestorName}</span>&rdquo; under another investor.</span>
              <span className="block mt-1">Both will become subgroups with their own investments. This persists across all snapshots.</span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
            {groupTargets.filter(t => t.id !== groupingInvestorId).length > 0 && (
              <div>
                <label className="text-sm font-medium mb-2 block">Group under existing investor</label>
                <input
                  type="text"
                  value={groupSearch}
                  onChange={e => setGroupSearch(e.target.value)}
                  className="w-full border border-input rounded px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground mb-2"
                  placeholder="Search investors..."
                />
                <div className="max-h-48 overflow-y-auto border rounded">
                  {groupTargets
                    .filter(t => t.id !== groupingInvestorId)
                    .filter(t => !groupSearch || t.name.toLowerCase().includes(groupSearch.toLowerCase()))
                    .map(t => (
                      <button
                        key={t.id}
                        onClick={() => groupingInvestorId && groupInvestor(groupingInvestorId, t.id)}
                        className="w-full text-left text-sm px-3 py-2 hover:bg-muted border-b last:border-b-0 block truncate"
                        title={t.name}
                      >
                        {t.name}
                      </button>
                    ))
                  }
                </div>
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-2 block">Or create a new group</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createGroupAndMerge()}
                  className="flex-1 border border-input rounded px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground"
                  placeholder="New group name..."
                />
                <Button onClick={createGroupAndMerge} disabled={!newGroupName.trim()}>
                  Create
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t pt-4">
            <Button variant="outline" onClick={() => setGroupingInvestorId(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Settings Dialog */}
      <Dialog open={reportSettingsOpen} onOpenChange={setReportSettingsOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>Report Settings</DialogTitle>
            <DialogDescription>Configure header, footer, and other report options for this snapshot.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Show Associates Calculations</label>
                <p className="text-xs text-muted-foreground">When on, displays pro-rata calculated values. When off, displays the original imported values.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={snapshot?.associates_calc_enabled !== false}
                onClick={() => {
                  const newVal = !(snapshot?.associates_calc_enabled !== false)
                  setSnapshot(prev => prev ? { ...prev, associates_calc_enabled: newVal } : prev)
                  fetch('/api/lps/snapshots', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: snapshotId, associatesCalcEnabled: newVal }),
                  })
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  snapshot?.associates_calc_enabled !== false ? 'bg-foreground' : 'bg-muted-foreground/30'
                }`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
                  snapshot?.associates_calc_enabled !== false ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-sm font-medium">Header</label>
                {savingDescription && <span className="text-xs text-muted-foreground">Saving...</span>}
              </div>
              <textarea
                value={description}
                onChange={e => handleDescriptionChange(e.target.value)}
                rows={3}
                className="w-full border border-input rounded p-2 text-sm bg-transparent text-foreground"
                placeholder="Since 2015, the Laconia team has raised over $130M in committed capital via 3 seed stage VC funds, 3 VC fund-of-funds vehicles, growth stage SPVs, and more. We have built durable infrastructure with institutional best practices to sustain scalable growth. Here is a summary of your investments across Laconia and related investments."
              />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-sm font-medium">Footer</label>
                {savingFooterNote && <span className="text-xs text-muted-foreground">Saving...</span>}
              </div>
              <textarea
                value={footerNote}
                onChange={e => handleFooterNoteChange(e.target.value)}
                rows={3}
                className="w-full border border-input rounded p-2 text-sm bg-transparent text-foreground"
                placeholder={'% Funded = Paid-In Capital / Commitment \u2022 DPI = Distributions / Paid-In Capital \u2022 RVPI = Net Asset Balance / Paid-In Capital \u2022 TVPI = DPI + RVPI \u2022 IRR = Internal Rate of Return. All data is reported net of expenses, including estimated carried interest.'}
              />
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t pt-4">
            <Button variant="outline" onClick={() => setReportSettingsOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Investor row component
// ---------------------------------------------------------------------------

function InvestorTreeRows({
  node,
  expanded,
  onToggle,
  onDeleteInvestment,
  fmt,
  editingInvestmentId,
  editDraft,
  setEditDraft,
  onStartEditInvestment,
  onSaveEditInvestment,
  onCancelEdit,
  editingInvestorId,
  editInvestorName,
  setEditInvestorName,
  onStartEditInvestorName,
  onSaveInvestorName,
  onOpenGroupDialog,
  onUngroupInvestor,
  snapshotId,
}: {
  node: InvestorNode
  expanded: Set<string>
  onToggle: (id: string) => void
  onDeleteInvestment: (id: string) => void
  fmt: (val: number) => string
  editingInvestmentId: string | null
  editDraft: Record<string, any>
  setEditDraft: (d: Record<string, any>) => void
  onStartEditInvestment: (inv: LpInvestment) => void
  onSaveEditInvestment: () => void
  onCancelEdit: () => void
  editingInvestorId: string | null
  editInvestorName: string
  setEditInvestorName: (name: string) => void
  onStartEditInvestorName: (id: string, name: string) => void
  onSaveInvestorName: () => void
  onOpenGroupDialog: (investorId: string, investorName: string) => void
  onUngroupInvestor: (investorId: string) => void
  snapshotId: string
}) {
  const isExpanded = expanded.has(node.investorId)
  const hasContent = node.investments.length > 0 || (node.children && node.children.length > 0)
  const isEditingName = editingInvestorId === node.investorId
  const isGroup = node.isGroup && node.children && node.children.length > 0

  return (
    <>
      {/* Investor / Group header row */}
      <tr
        className={`border-b last:border-b-0 hover:bg-muted/30 group/row ${hasContent && !isEditingName ? 'cursor-pointer' : ''}`}
        onClick={() => !isEditingName && hasContent && onToggle(node.investorId)}
      >
        <td className="px-3 py-2 sticky left-0 bg-background z-10">
          <div className="flex items-center gap-1 max-w-[250px]">
            {hasContent
              ? (isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />)
              : <span className="w-3.5" />
            }
            {isEditingName ? (
              <input
                type="text"
                value={editInvestorName}
                onChange={e => setEditInvestorName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') onSaveInvestorName()
                  if (e.key === 'Escape') onCancelEdit()
                }}
                onBlur={onSaveInvestorName}
                onClick={e => e.stopPropagation()}
                className="border border-input rounded px-1 py-0.5 text-sm bg-transparent text-foreground w-full min-w-[120px]"
                autoFocus
              />
            ) : (
              <>
                <span className={`truncate ${isGroup ? 'font-medium' : ''}`} title={node.investorName}>{node.investorName}</span>
                {isGroup && node.children && (
                  <span className="text-xs text-muted-foreground ml-1 shrink-0">({node.children.length})</span>
                )}
                {!isGroup && node.investments.length > 1 && (
                  <span className="text-xs text-muted-foreground ml-1 shrink-0">({node.investments.length})</span>
                )}
                <button
                  onClick={e => { e.stopPropagation(); onStartEditInvestorName(node.investorId, node.investorName) }}
                  className="text-muted-foreground hover:text-foreground opacity-0 group-hover/row:opacity-100 ml-1 shrink-0"
                  title="Edit name"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                {hasContent && (
                  <a
                    href={`/lps/${snapshotId}/${node.investorId}`}
                    onClick={e => e.stopPropagation()}
                    className="text-muted-foreground hover:text-foreground opacity-0 group-hover/row:opacity-100 ml-0.5 shrink-0"
                    title="View investor report"
                  >
                    <FileText className="h-3 w-3" />
                  </a>
                )}
                {!isGroup && (
                  <button
                    onClick={e => { e.stopPropagation(); onOpenGroupDialog(node.investorId, node.investorName) }}
                    className="text-muted-foreground hover:text-foreground opacity-0 group-hover/row:opacity-100 ml-0.5 shrink-0"
                    title="Group under another investor"
                  >
                    <Users className="h-3 w-3" />
                  </button>
                )}
              </>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-right font-mono">{fmt(node.commitment)}</td>
        <td className="px-3 py-2 text-right font-mono">{fmt(node.paidInCapital)}</td>
        <td className="px-3 py-2 text-right font-mono">{fmt(node.distributions)}</td>
        <td className="px-3 py-2 text-right font-mono">{fmt(node.unrealizedValue)}</td>
        <td className="px-3 py-2 text-right font-mono">{fmt(node.totalValue)}</td>
        <td className="px-3 py-2 text-right font-mono">{fmtPct(node.pctFunded)}</td>
        <td className="px-3 py-2 text-right font-mono">{fmtMoic(node.dpi)}</td>
        <td className="px-3 py-2 text-right font-mono">{fmtMoic(node.rvpi)}</td>
        <td className="px-3 py-2 text-right font-mono">{fmtMoic(node.tvpi)}</td>
        <td className="px-3 py-2 text-right font-mono">{fmtPct(node.irr)}</td>
        {(() => {
          const ir = fmtImported(node.importedRvpi, node.rvpi)
          const it = fmtImported(node.importedTvpi, node.tvpi)
          return (
            <>
              <td className={`px-3 py-2 text-right font-mono text-xs ${ir.deviated ? 'text-amber-600 font-semibold' : 'text-muted-foreground/60'}`}>{ir.text}</td>
              <td className={`px-3 py-2 text-right font-mono text-xs ${it.deviated ? 'text-amber-600 font-semibold' : 'text-muted-foreground/60'}`}>{it.text}</td>
            </>
          )
        })()}
        <td className="px-3 py-2"></td>
      </tr>

      {/* Expanded: group children (subgroups) or flat investments */}
      {isExpanded && isGroup && node.children?.map(child => {
        const childExpanded = expanded.has(child.investorId)
        const childEditingName = editingInvestorId === child.investorId
        const isSynthetic = child.investorId.endsWith('-own')
        return (
          <React.Fragment key={child.investorId}>
            <tr
              className={`border-b last:border-b-0 bg-muted/10 hover:bg-muted/20 group/child ${!childEditingName ? 'cursor-pointer' : ''}`}
              onClick={() => !childEditingName && onToggle(child.investorId)}
            >
              <td className="py-1.5 sticky left-0 bg-muted/10 z-10" style={{ paddingLeft: 26 }}>
                <div className="flex items-center gap-1 max-w-[220px]">
                  {childExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                  {!isSynthetic && childEditingName ? (
                    <input
                      type="text"
                      value={editInvestorName}
                      onChange={e => setEditInvestorName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') onSaveInvestorName()
                        if (e.key === 'Escape') onCancelEdit()
                      }}
                      onBlur={onSaveInvestorName}
                      onClick={e => e.stopPropagation()}
                      className="border border-input rounded px-1 py-0.5 text-xs bg-transparent text-foreground w-full min-w-[100px]"
                      autoFocus
                    />
                  ) : (
                    <>
                      <span className="truncate text-sm" title={child.investorName}>{child.investorName}</span>
                      {child.investments.length > 1 && (
                        <span className="text-xs text-muted-foreground ml-1 shrink-0">({child.investments.length})</span>
                      )}
                      {!isSynthetic && (
                        <button
                          onClick={e => { e.stopPropagation(); onStartEditInvestorName(child.investorId, child.investorName) }}
                          className="text-muted-foreground hover:text-foreground opacity-0 group-hover/child:opacity-100 ml-1 shrink-0"
                          title="Edit name"
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                      )}
                      {!isSynthetic && (
                        <a
                          href={`/lps/${snapshotId}/${child.investorId}`}
                          onClick={e => e.stopPropagation()}
                          className="text-muted-foreground hover:text-foreground opacity-0 group-hover/child:opacity-100 ml-0.5 shrink-0"
                          title="View investor report"
                        >
                          <FileText className="h-2.5 w-2.5" />
                        </a>
                      )}
                      {!isSynthetic && (
                        <button
                          onClick={e => { e.stopPropagation(); onUngroupInvestor(child.investorId) }}
                          className="text-muted-foreground hover:text-foreground opacity-0 group-hover/child:opacity-100 ml-0.5 shrink-0"
                          title="Remove from group"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-sm">{fmt(child.commitment)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-sm">{fmt(child.paidInCapital)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-sm">{fmt(child.distributions)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-sm">{fmt(child.unrealizedValue)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-sm">{fmt(child.totalValue)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-sm">{fmtPct(child.pctFunded)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-sm">{fmtMoic(child.dpi)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-sm">{fmtMoic(child.rvpi)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-sm">{fmtMoic(child.tvpi)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-sm">{fmtPct(child.irr)}</td>
              {(() => {
                const ir = fmtImported(child.importedRvpi, child.rvpi)
                const it = fmtImported(child.importedTvpi, child.tvpi)
                return (
                  <>
                    <td className={`px-3 py-1.5 text-right font-mono text-xs ${ir.deviated ? 'text-amber-600 font-semibold' : 'text-muted-foreground/60'}`}>{ir.text}</td>
                    <td className={`px-3 py-1.5 text-right font-mono text-xs ${it.deviated ? 'text-amber-600 font-semibold' : 'text-muted-foreground/60'}`}>{it.text}</td>
                  </>
                )
              })()}
              <td className="px-3 py-1.5"></td>
            </tr>
            {childExpanded && child.investments.map(inv => (
              <InvestmentRow
                key={inv.id}
                inv={inv}
                padLeft={44}
                fmt={fmt}
                editingInvestmentId={editingInvestmentId}
                editDraft={editDraft}
                setEditDraft={setEditDraft}
                onStartEditInvestment={onStartEditInvestment}
                onSaveEditInvestment={onSaveEditInvestment}
                onCancelEdit={onCancelEdit}
                onDeleteInvestment={onDeleteInvestment}
              />
            ))}
          </React.Fragment>
        )
      })}

      {/* Expanded: flat investments (non-group investor) */}
      {isExpanded && !isGroup && node.investments.map(inv => (
        <InvestmentRow
          key={inv.id}
          inv={inv}
          padLeft={26}
          fmt={fmt}
          editingInvestmentId={editingInvestmentId}
          editDraft={editDraft}
          setEditDraft={setEditDraft}
          onStartEditInvestment={onStartEditInvestment}
          onSaveEditInvestment={onSaveEditInvestment}
          onCancelEdit={onCancelEdit}
          onDeleteInvestment={onDeleteInvestment}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Investment row
// ---------------------------------------------------------------------------

function InvestmentRow({
  inv,
  padLeft,
  fmt,
  editingInvestmentId,
  editDraft,
  setEditDraft,
  onStartEditInvestment,
  onSaveEditInvestment,
  onCancelEdit,
  onDeleteInvestment,
}: {
  inv: LpInvestment
  padLeft: number
  fmt: (val: number) => string
  editingInvestmentId: string | null
  editDraft: Record<string, any>
  setEditDraft: (d: Record<string, any>) => void
  onStartEditInvestment: (inv: LpInvestment) => void
  onSaveEditInvestment: () => void
  onCancelEdit: () => void
  onDeleteInvestment: (id: string) => void
}) {
  const isEditing = editingInvestmentId === inv.id
  return (
    <tr className="border-b last:border-b-0 bg-muted/20 group/inv">
      {isEditing ? (
        <EditableInvestmentRow
          inv={inv}
          draft={editDraft}
          setDraft={setEditDraft}
          onSave={onSaveEditInvestment}
          onCancel={onCancelEdit}
          fmt={fmt}
          padLeft={padLeft}
        />
      ) : (
        <>
          <td className="px-3 py-1.5 sticky left-0 bg-muted/20 z-10 text-muted-foreground text-xs" style={{ paddingLeft: padLeft }}>
            <div className="flex items-center gap-1 max-w-[220px]">
              <span className="truncate" title={`${inv.lp_entities?.entity_name} · ${inv.portfolio_group}`}>
                {inv.lp_entities?.entity_name}
                <span className="mx-1.5 text-muted-foreground/50">&middot;</span>
                <span className="text-muted-foreground/70">{inv.portfolio_group}</span>
              </span>
              <button
                onClick={() => onStartEditInvestment(inv)}
                className="text-muted-foreground hover:text-foreground opacity-0 group-hover/inv:opacity-100 ml-1 shrink-0"
                title="Edit"
              >
                <Pencil className="h-2.5 w-2.5" />
              </button>
            </div>
          </td>
          {(() => {
            const pic = Number(inv.paid_in_capital) || Number(inv.called_capital) || 0
            const dist = Number(inv.distributions) || 0
            const navVal = Number(inv.nav) || 0
            const calcDpi = pic > 0 ? dist / pic : null
            const calcRvpi = pic > 0 ? navVal / pic : null
            const calcTvpi = calcDpi != null && calcRvpi != null ? calcDpi + calcRvpi : null
            return (
              <>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{inv.commitment != null ? fmt(Number(inv.commitment)) : '-'}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{pic ? fmt(pic) : '-'}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{inv.distributions != null ? fmt(dist) : '-'}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{inv.nav != null ? fmt(navVal) : '-'}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{inv.total_value != null ? fmt(Number(inv.total_value)) : '-'}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{fmtPct((Number(inv.commitment) || 0) > 0 ? pic / (Number(inv.commitment) || 1) : null)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{fmtMoic(calcDpi)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{fmtMoic(calcRvpi)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{fmtMoic(calcTvpi)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{fmtPct(inv.irr != null ? Number(inv.irr) : null)}</td>
                {(() => {
                  const impRvpi = inv.rvpi != null ? Number(inv.rvpi) : null
                  const impTvpi = inv.tvpi != null ? Number(inv.tvpi) : null
                  const ir = fmtImported(impRvpi, calcRvpi)
                  const it = fmtImported(impTvpi, calcTvpi)
                  return (
                    <>
                      <td className={`px-3 py-1.5 text-right font-mono text-xs ${ir.deviated ? 'text-amber-600 font-semibold' : 'text-muted-foreground/60'}`}>{ir.text}</td>
                      <td className={`px-3 py-1.5 text-right font-mono text-xs ${it.deviated ? 'text-amber-600 font-semibold' : 'text-muted-foreground/60'}`}>{it.text}</td>
                    </>
                  )
                })()}
              </>
            )
          })()}
          <td className="px-3 py-1.5">
            <button
              onClick={() => onDeleteInvestment(inv.id)}
              className="text-muted-foreground hover:text-red-600"
              title="Delete investment"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </td>
        </>
      )}
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Editable investment row
// ---------------------------------------------------------------------------

function EditableInvestmentRow({
  inv,
  draft,
  setDraft,
  onSave,
  onCancel,
  fmt,
  padLeft,
}: {
  inv: LpInvestment
  draft: Record<string, any>
  setDraft: (d: Record<string, any>) => void
  onSave: () => void
  onCancel: () => void
  fmt: (val: number) => string
  padLeft: number
}) {
  const updateField = (field: string, value: any) => {
    setDraft({ ...draft, [field]: value })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSave()
    if (e.key === 'Escape') onCancel()
  }

  const numInput = (field: string, step?: string) => (
    <input
      type="number"
      value={draft[field] ?? ''}
      onChange={e => updateField(field, e.target.value === '' ? null : parseFloat(e.target.value))}
      onKeyDown={handleKeyDown}
      step={step || 'any'}
      className="w-full border border-input rounded px-1 py-0.5 text-xs text-right font-mono bg-transparent text-foreground"
    />
  )

  return (
    <>
      <td className="px-3 py-1.5 sticky left-0 bg-muted/20 z-10" style={{ paddingLeft: padLeft }}>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={draft.portfolio_group ?? ''}
            onChange={e => updateField('portfolio_group', e.target.value)}
            onKeyDown={handleKeyDown}
            className="border border-input rounded px-1 py-0.5 text-xs bg-transparent text-foreground w-full min-w-[100px]"
            placeholder="Portfolio group"
          />
          <button onClick={onSave} className="text-green-600 hover:text-green-700 shrink-0" title="Save">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground shrink-0" title="Cancel">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
      <td className="px-1 py-1.5">{numInput('commitment')}</td>
      <td className="px-1 py-1.5">{numInput('paid_in_capital')}</td>
      <td className="px-1 py-1.5">{numInput('distributions')}</td>
      <td className="px-1 py-1.5">{numInput('nav')}</td>
      <td className="px-1 py-1.5">{numInput('total_value')}</td>
      {(() => {
        const pic = Number(draft.paid_in_capital) || 0
        const comm = Number(draft.commitment) || 0
        const dist = Number(draft.distributions) || 0
        const navVal = Number(draft.nav) || 0
        const pf = comm > 0 ? pic / comm : null
        const d = pic > 0 ? dist / pic : null
        const r = pic > 0 ? navVal / pic : null
        const t = d != null && r != null ? d + r : null
        return (
          <>
            <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">{fmtPct(pf)}</td>
            <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">{fmtMoic(d)}</td>
            <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">{fmtMoic(r)}</td>
            <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">{fmtMoic(t)}</td>
          </>
        )
      })()}
      <td className="px-1 py-1.5">{numInput('irr', '0.001')}</td>
      <td className="px-1 py-1.5"></td>
      <td className="px-1 py-1.5"></td>
      <td className="px-1 py-1.5"></td>
    </>
  )
}
