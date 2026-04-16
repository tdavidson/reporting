'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Pencil, X, Save, Upload, Sparkles, ExternalLink, FilePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCurrency } from '@/components/currency-context'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GroupConfig {
  cashOnHand: number
  carryRate: number
  gpCommitPct: number
  vintage: number | null
  managementFeeRate: number
  navMode: 'metric' | 'manual'
  navOverride: number | null
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val: string | undefined, suffix = '') {
  if (!val || val === '') return '—'
  return val + suffix
}

function fmtPct(val: string | undefined) {
  if (!val || val === '') return '—'
  return `${val}%`
}

function fmtBool(val: string | undefined) {
  if (val === 'true') return 'Sim'
  if (val === 'false') return 'Não'
  return '—'
}

// ── View: term sheet row ───────────────────────────────────────────────────────

function Row({ label, value, mono = false, accent = false }: {
  label: string
  value: string
  mono?: boolean
  accent?: boolean
}) {
  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-2.5 pr-6 text-xs text-muted-foreground whitespace-nowrap w-48 align-top">{label}</td>
      <td className={`py-2.5 text-sm ${mono ? 'font-mono' : ''} ${accent ? 'font-medium' : ''} ${value === '—' ? 'text-muted-foreground' : 'text-foreground'}`}>
        {value}
      </td>
    </tr>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground mb-2 pb-1.5 border-b border-border/50">
        {title}
      </p>
      <table className="w-full">
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

// ── Edit: field ───────────────────────────────────────────────────────────────

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'border rounded px-2 py-1.5 text-sm w-full bg-transparent'
const monoInputCls = inputCls + ' font-mono'

// ── Main component ─────────────────────────────────────────────────────────────

export function ContractualTab({
  group,
  groupConfig,
  onConfigChange,
}: {
  group: string
  groupConfig: GroupConfig
  onConfigChange: (patch: Partial<GroupConfig>) => void
}) {
  const currency = useCurrency()
  const symbol = currency === 'BRL' ? 'R$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'

  const [editMode, setEditMode] = useState(false)
  const [termsDraft, setTermsDraft] = useState<Record<string, string>>({})
  const [termsDirty, setTermsDirty] = useState(false)
  const [loadingContract, setLoadingContract] = useState(false)
  const [savingTerms, setSavingTerms] = useState(false)

  const [documents, setDocuments] = useState<FundContractDocument[]>([])
  const [addDocOpen, setAddDocOpen] = useState(false)
  const [docDraft, setDocDraft] = useState({ name: '', docType: 'LPA', version: '', effectiveDate: '', url: '', notes: '' })
  const [savingDoc, setSavingDoc] = useState(false)
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null)

  const [analyzeFile, setAnalyzeFile] = useState<File | null>(null)
  const [analyzeDocName, setAnalyzeDocName] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const groupConfigRef = useRef(groupConfig)
  useEffect(() => { groupConfigRef.current = groupConfig }, [groupConfig])

  // Load
  useEffect(() => {
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
          base['carry_rate'] = String(gc.carryRate * 100)
          base['management_fee_rate'] = String(gc.managementFeeRate * 100)
          base['gp_commit_pct'] = String(gc.gpCommitPct * 100)
          setTermsDraft(base)
          if (d) setDocuments(d)
        }
      } finally {
        setLoadingContract(false)
      }
    }
    load()
  }, [group])

  // Sync config → draft
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
        else if (['management_fee_rate', 'carry_rate', 'hurdle_rate', 'catch_up_rate',
          'gp_commit_pct', 'recycling_cap', 'vintage', 'term_years',
          'investment_period_years'].includes(k)) {
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

      if (contractRes.ok) {
        setTermsDirty(false)
        setEditMode(false)
      }
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

  async function handleAnalyze() {
    if (!analyzeFile) return
    setAnalyzing(true)
    setAnalyzeError(null)
    try {
      const fd = new FormData()
      fd.append('file', analyzeFile)
      fd.append('portfolioGroup', group)
      fd.append('docName', analyzeDocName || analyzeFile.name || 'Regulamento')
      fd.append('docType', 'LPA')

      const res = await fetch('/api/portfolio/fund-contracts/analyze', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setAnalyzeError(data.error ?? 'Erro ao analisar'); return }

      const reload = await fetch(`/api/portfolio/fund-contracts?group=${encodeURIComponent(group)}`)
      if (reload.ok) {
        const { terms: t, documents: d } = await reload.json()
        if (d) setDocuments(d)
        if (t && t.length > 0) {
          const base: Record<string, string> = {}
          for (const [k, v] of Object.entries(t[0])) {
            if (v != null) base[k] = String(v)
          }
          const gc = groupConfigRef.current
          base['carry_rate'] = String(gc.carryRate * 100)
          base['management_fee_rate'] = String(gc.managementFeeRate * 100)
          base['gp_commit_pct'] = String(gc.gpCommitPct * 100)
          if (gc.vintage != null) base['vintage'] = String(gc.vintage)
          setTermsDraft(base)
          setTermsDirty(false)
          const record = t[0]
          onConfigChange({
            vintage: record.vintage != null ? Number(record.vintage) : null,
            carryRate: record.carry_rate != null ? Number(record.carry_rate) : 0.20,
            managementFeeRate: record.management_fee_rate != null ? Number(record.management_fee_rate) : 0,
            gpCommitPct: record.gp_commit_pct != null ? Number(record.gp_commit_pct) : 0,
          })
        }
      }
      setAnalyzeOpen(false)
      setAnalyzeFile(null)
      setAnalyzeDocName('')
    } catch (e: any) {
      setAnalyzeError(e.message ?? 'Erro inesperado')
    } finally {
      setAnalyzing(false)
    }
  }

  if (loadingContract) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando dados contratuais…
      </div>
    )
  }

  const d = termsDraft

  return (
    <div className="space-y-6">

      {/* ── AI Analyzer strip ── */}
      <div className="border rounded-lg p-3 bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Analisar regulamento com IA</span>
          </div>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => setAnalyzeOpen(v => !v)}>
            {analyzeOpen ? 'Fechar' : 'Importar documento'}
          </Button>
        </div>

        {analyzeOpen && (
          <div className="mt-3 space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0] ?? null
                setAnalyzeFile(f)
                if (f && !analyzeDocName) setAnalyzeDocName(f.name.replace(/\.[^.]+$/, ''))
              }}
            />
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Arquivo (PDF ou Word) *</label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 border rounded px-3 py-2 text-sm w-full bg-transparent hover:bg-muted/30 transition-colors text-left"
              >
                <Upload className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                {analyzeFile
                  ? <span className="truncate">{analyzeFile.name}</span>
                  : <span className="text-muted-foreground">Selecionar arquivo…</span>}
              </button>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nome do documento</label>
              <input
                type="text"
                value={analyzeDocName}
                onChange={e => setAnalyzeDocName(e.target.value)}
                placeholder="Regulamento (opcional)"
                className={inputCls}
              />
            </div>
            {analyzeError && <p className="text-xs text-red-600">{analyzeError}</p>}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleAnalyze} disabled={analyzing || !analyzeFile}>
                {analyzing
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Analisando…</>
                  : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Analisar e preencher</>}
              </Button>
              {analyzing && <span className="text-xs text-muted-foreground">Aguarde ~30s</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── Term sheet / Edit toggle ── */}
      <div className="border rounded-lg overflow-hidden">

        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
          <div>
            <p className="text-sm font-medium">{d['fund_name'] || group}</p>
            {d['cnpj'] && <p className="text-xs text-muted-foreground font-mono mt-0.5">{d['cnpj']}</p>}
          </div>
          {!editMode ? (
            <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => setEditMode(true)}>
              <Pencil className="h-3 w-3" /> Editar
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" className="text-xs gap-1.5" onClick={handleSaveTerms} disabled={savingTerms}>
                {savingTerms
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Save className="h-3 w-3" />}
                Salvar
              </Button>
              <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => { setEditMode(false); setTermsDirty(false) }}>
                <X className="h-3 w-3" /> Cancelar
              </Button>
            </div>
          )}
        </div>

        {/* ── VIEW MODE ── */}
        {!editMode && (
          <div className="px-5 py-4 space-y-6">

            {/* Key metrics strip */}
            <div className="grid grid-cols-4 gap-px bg-border/40 rounded-md overflow-hidden border border-border/40">
              {[
                { label: 'Carry / Performance', value: fmtPct(d['carry_rate']) },
                { label: 'Taxa de administração', value: fmtPct(d['management_fee_rate']) },
                { label: 'Hurdle rate', value: d['hurdle_rate'] ? `${d['hurdle_rate']}%` : '—' },
                { label: 'Prazo do fundo', value: d['term_years'] ? `${d['term_years']} anos` : '—' },
              ].map(m => (
                <div key={m.label} className="bg-background px-4 py-3 text-center">
                  <p className="text-lg font-medium">{m.value}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>

            {/* Identidade */}
            <Section title="Identidade do fundo">
              <Row label="Nome completo" value={fmt(d['fund_name'], '')} />
              <Row label="CNPJ" value={fmt(d['cnpj'])} mono />
              <Row label="Vintage" value={fmt(d['vintage'])} />
            </Section>

            {/* Partes */}
            <Section title="Partes">
              <Row label="Gestor (GP)" value={fmt(d['gp_name'])} />
              <Row label="Cotistas / LPs" value={fmt(d['lp_names'])} />
              <Row label="Administrador" value={fmt(d['fund_administrator'])} />
              <Row label="Auditor" value={fmt(d['auditor'])} />
              <Row label="Assessor jurídico" value={fmt(d['legal_counsel'])} />
            </Section>

            {/* Termos econômicos */}
            <Section title="Termos econômicos">
              <Row label="Taxa de administração" value={fmtPct(d['management_fee_rate'])} accent />
              <Row label="Base de cálculo" value={fmt(d['management_fee_basis'])} />
              <Row label="Carry / Performance" value={fmtPct(d['carry_rate'])} accent />
              <Row label="Hurdle rate" value={d['hurdle_rate'] ? `${d['hurdle_rate']}%` : '—'} accent />
              <Row label="Tipo de hurdle" value={fmt(d['hurdle_type'])} />
              <Row label="Catch-up rate" value={d['catch_up_rate'] ? `${d['catch_up_rate']}%` : '—'} />
              <Row label="Waterfall" value={fmt(d['waterfall_type'])} />
              <Row label="Comprometimento do GP" value={d['gp_commit_pct'] ? `${d['gp_commit_pct']}%` : '—'} />
              <Row label="Reciclagem de capital" value={fmtBool(d['recycling_allowed'])} />
              <Row label={`Limite de reciclagem (${symbol})`} value={fmt(d['recycling_cap'])} />
            </Section>

            {/* Prazo e estrutura */}
            <Section title="Prazo e estrutura">
              <Row label="Prazo total" value={d['term_years'] ? `${d['term_years']} anos` : '—'} />
              <Row label="Período de investimento" value={d['investment_period_years'] ? `${d['investment_period_years']} anos` : '—'} />
              <Row label="Opções de prorrogação" value={fmt(d['extension_options'])} />
            </Section>

            {/* Relatórios */}
            <Section title="Relatórios e auditoria">
              <Row label="Frequência de relatórios" value={fmt(d['reporting_frequency'])} />
              <Row label="Auditoria obrigatória" value={fmtBool(d['audit_required'])} />
            </Section>
          </div>
        )}

        {/* ── EDIT MODE ── */}
        {editMode && (
          <div className="px-5 py-4 space-y-6">

            {/* Identidade */}
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground mb-3 pb-1.5 border-b">
                Identidade do fundo
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <EditField label="Nome do fundo">
                    <input type="text" value={d['fund_name'] ?? ''} onChange={e => setDraftField('fund_name', e.target.value)} placeholder={group} className={inputCls} />
                  </EditField>
                </div>
                <EditField label="CNPJ">
                  <input type="text" value={d['cnpj'] ?? ''} onChange={e => setDraftField('cnpj', e.target.value)} placeholder="00.000.000/0001-00" className={monoInputCls} />
                </EditField>
                <EditField label="Vintage">
                  <input type="number" step="1" min="1900" max="2100" value={d['vintage'] ?? ''} onChange={e => setDraftField('vintage', e.target.value)} placeholder="—" className={monoInputCls} />
                </EditField>
                <EditField label="Carry rate (%)">
                  <input type="number" step="0.01" value={d['carry_rate'] ?? ''} onChange={e => setDraftField('carry_rate', e.target.value)} placeholder="—" className={monoInputCls} />
                </EditField>
                <EditField label="GP commit (%)">
                  <input type="number" step="0.01" value={d['gp_commit_pct'] ?? ''} onChange={e => setDraftField('gp_commit_pct', e.target.value)} placeholder="—" className={monoInputCls} />
                </EditField>
                <EditField label="Taxa de administração (% a.a.)">
                  <input type="number" step="0.01" value={d['management_fee_rate'] ?? ''} onChange={e => setDraftField('management_fee_rate', e.target.value)} placeholder="—" className={monoInputCls} />
                </EditField>
                <div className="md:col-span-2">
                  <EditField label="Base de cálculo">
                    <input type="text" value={d['management_fee_basis'] ?? ''} onChange={e => setDraftField('management_fee_basis', e.target.value)} placeholder="ex: capital comprometido" className={inputCls} />
                  </EditField>
                </div>
              </div>
            </div>

            {/* Partes */}
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground mb-3 pb-1.5 border-b">
                Partes
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <EditField label="Gestor (GP)">
                  <input type="text" value={d['gp_name'] ?? ''} onChange={e => setDraftField('gp_name', e.target.value)} placeholder="—" className={inputCls} />
                </EditField>
                <div className="md:col-span-2">
                  <EditField label="Cotistas / LPs">
                    <input type="text" value={d['lp_names'] ?? ''} onChange={e => setDraftField('lp_names', e.target.value)} placeholder="—" className={inputCls} />
                  </EditField>
                </div>
                <EditField label="Administrador">
                  <input type="text" value={d['fund_administrator'] ?? ''} onChange={e => setDraftField('fund_administrator', e.target.value)} placeholder="—" className={inputCls} />
                </EditField>
                <EditField label="Auditor">
                  <input type="text" value={d['auditor'] ?? ''} onChange={e => setDraftField('auditor', e.target.value)} placeholder="—" className={inputCls} />
                </EditField>
                <EditField label="Assessor jurídico">
                  <input type="text" value={d['legal_counsel'] ?? ''} onChange={e => setDraftField('legal_counsel', e.target.value)} placeholder="—" className={inputCls} />
                </EditField>
              </div>
            </div>

            {/* Economics */}
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground mb-3 pb-1.5 border-b">
                Termos econômicos
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <EditField label="Hurdle rate (%)">
                  <input type="number" step="0.01" value={d['hurdle_rate'] ?? ''} onChange={e => setDraftField('hurdle_rate', e.target.value)} placeholder="—" className={monoInputCls} />
                </EditField>
                <div className="md:col-span-2">
                  <EditField label="Tipo de hurdle">
                    <input type="text" value={d['hurdle_type'] ?? ''} onChange={e => setDraftField('hurdle_type', e.target.value)} placeholder="ex: retorno preferencial" className={inputCls} />
                  </EditField>
                </div>
                <EditField label="Catch-up rate (%)">
                  <input type="number" step="0.01" value={d['catch_up_rate'] ?? ''} onChange={e => setDraftField('catch_up_rate', e.target.value)} placeholder="—" className={monoInputCls} />
                </EditField>
                <EditField label="Tipo de waterfall">
                  <input type="text" value={d['waterfall_type'] ?? ''} onChange={e => setDraftField('waterfall_type', e.target.value)} placeholder="ex: europeu" className={inputCls} />
                </EditField>
                <EditField label="Reciclagem permitida">
                  <Select value={d['recycling_allowed'] ?? ''} onValueChange={v => setDraftField('recycling_allowed', v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Sim</SelectItem>
                      <SelectItem value="false">Não</SelectItem>
                    </SelectContent>
                  </Select>
                </EditField>
                <EditField label={`Limite de reciclagem (${symbol})`}>
                  <input type="number" step="0.01" value={d['recycling_cap'] ?? ''} onChange={e => setDraftField('recycling_cap', e.target.value)} placeholder="—" className={monoInputCls} />
                </EditField>
              </div>
            </div>

            {/* Structure */}
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground mb-3 pb-1.5 border-b">
                Prazo, estrutura e relatórios
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <EditField label="Prazo total (anos)">
                  <input type="number" step="1" value={d['term_years'] ?? ''} onChange={e => setDraftField('term_years', e.target.value)} placeholder="—" className={monoInputCls} />
                </EditField>
                <EditField label="Período de investimento (anos)">
                  <input type="number" step="1" value={d['investment_period_years'] ?? ''} onChange={e => setDraftField('investment_period_years', e.target.value)} placeholder="—" className={monoInputCls} />
                </EditField>
                <EditField label="Opções de prorrogação">
                  <input type="text" value={d['extension_options'] ?? ''} onChange={e => setDraftField('extension_options', e.target.value)} placeholder="ex: 2 prorrogações de 1 ano" className={inputCls} />
                </EditField>
                <EditField label="Frequência de relatórios">
                  <input type="text" value={d['reporting_frequency'] ?? ''} onChange={e => setDraftField('reporting_frequency', e.target.value)} placeholder="ex: trimestral" className={inputCls} />
                </EditField>
                <EditField label="Auditoria obrigatória">
                  <Select value={d['audit_required'] ?? ''} onValueChange={v => setDraftField('audit_required', v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Sim</SelectItem>
                      <SelectItem value="false">Não</SelectItem>
                    </SelectContent>
                  </Select>
                </EditField>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* ── Documents ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Documentos</h3>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => setAddDocOpen(true)}>
            <FilePlus className="h-3.5 w-3.5 mr-1" /> Adicionar
          </Button>
        </div>

        {addDocOpen && (
          <div className="border rounded-lg p-3 mb-3 space-y-3 bg-muted/30">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <EditField label="Nome do documento *">
                  <input type="text" value={docDraft.name} onChange={e => setDocDraft(d => ({ ...d, name: e.target.value }))} placeholder="ex: Regulamento do Fundo" className={inputCls} autoFocus />
                </EditField>
              </div>
              <EditField label="Tipo">
                <Select value={docDraft.docType} onValueChange={v => setDocDraft(d => ({ ...d, docType: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </EditField>
              <EditField label="Versão">
                <input type="text" value={docDraft.version} onChange={e => setDocDraft(d => ({ ...d, version: e.target.value }))} placeholder="v1.0" className={inputCls} />
              </EditField>
              <EditField label="Data de vigência">
                <input type="date" value={docDraft.effectiveDate} onChange={e => setDocDraft(d => ({ ...d, effectiveDate: e.target.value }))} className={inputCls} />
              </EditField>
              <EditField label="URL">
                <input type="url" value={docDraft.url} onChange={e => setDocDraft(d => ({ ...d, url: e.target.value }))} placeholder="https://…" className={inputCls} />
              </EditField>
              <div className="md:col-span-3">
                <EditField label="Notas">
                  <input type="text" value={docDraft.notes} onChange={e => setDocDraft(d => ({ ...d, notes: e.target.value }))} placeholder="—" className={inputCls} />
                </EditField>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddDocument} disabled={savingDoc || !docDraft.name}>
                {savingDoc && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />} Salvar
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAddDocOpen(false)}>Cancelar</Button>
            </div>
          </div>
        )}

        {documents.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum documento adicionado.</p>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium">Nome</th>
                  <th className="text-left px-3 py-2 font-medium">Tipo</th>
                  <th className="text-left px-3 py-2 font-medium">Versão</th>
                  <th className="text-left px-3 py-2 font-medium">Data</th>
                  <th className="text-left px-3 py-2 font-medium">Notas</th>
                  <th className="px-3 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {documents.map(doc => (
                  <tr key={doc.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      {doc.url
                        ? <a href={doc.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">{doc.name}<ExternalLink className="h-3 w-3" /></a>
                        : doc.name}
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
      </div>
    </div>
  )
}
