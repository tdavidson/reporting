'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Scale, ExternalLink, AlertTriangle, X, SlidersHorizontal, Check, Plus, Trash2, Pencil, Sparkles, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import type { Regulation, Issuer, ImpactEntry } from '@/lib/regulacoes/types'

const ALL_TAGS = ['Crypto','Payments','Banking','Open Finance','AML','Credit','Capital Markets','ESG','Data & Privacy','FX'] as const
type Tag = typeof ALL_TAGS[number]

const TAG_COLORS: Record<Tag, { dot: string; bg: string; text: string; border: string }> = {
  'Crypto':          { dot: 'bg-violet-500',  bg: 'bg-violet-500/8',  text: 'text-violet-600 dark:text-violet-400',  border: 'border-violet-500/30' },
  'Payments':        { dot: 'bg-emerald-500', bg: 'bg-emerald-500/8', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/30' },
  'Banking':         { dot: 'bg-blue-500',    bg: 'bg-blue-500/8',    text: 'text-blue-600 dark:text-blue-400',      border: 'border-blue-500/30' },
  'Open Finance':    { dot: 'bg-teal-500',    bg: 'bg-teal-500/8',    text: 'text-teal-600 dark:text-teal-400',      border: 'border-teal-500/30' },
  'AML':             { dot: 'bg-red-500',     bg: 'bg-red-500/8',     text: 'text-red-600 dark:text-red-400',        border: 'border-red-500/30' },
  'Credit':          { dot: 'bg-orange-500',  bg: 'bg-orange-500/8',  text: 'text-orange-600 dark:text-orange-400',  border: 'border-orange-500/30' },
  'Capital Markets': { dot: 'bg-indigo-500',  bg: 'bg-indigo-500/8',  text: 'text-indigo-600 dark:text-indigo-400',  border: 'border-indigo-500/30' },
  'ESG':             { dot: 'bg-lime-500',    bg: 'bg-lime-500/8',    text: 'text-lime-600 dark:text-lime-500',      border: 'border-lime-500/30' },
  'Data & Privacy':  { dot: 'bg-pink-500',    bg: 'bg-pink-500/8',    text: 'text-pink-600 dark:text-pink-400',      border: 'border-pink-500/30' },
  'FX':              { dot: 'bg-amber-500',   bg: 'bg-amber-500/8',   text: 'text-amber-600 dark:text-amber-400',    border: 'border-amber-500/30' },
}
const DEFAULT_COLOR = { dot: 'bg-slate-400', bg: 'bg-slate-500/8', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-500/30' }
function getRegColor(reg: Regulation) {
  const t = reg.tags?.[0] as Tag | undefined
  return t ? (TAG_COLORS[t] ?? DEFAULT_COLOR) : DEFAULT_COLOR
}

const ISSUER_STYLES: Record<Issuer, { badge: string; badgeText: string; label: string }> = {
  CVM:   { badge: 'bg-blue-500/10',    badgeText: 'text-blue-600 dark:text-blue-400',       label: 'CVM'   },
  BCB:   { badge: 'bg-emerald-500/10', badgeText: 'text-emerald-600 dark:text-emerald-400', label: 'BCB'   },
  CMN:   { badge: 'bg-amber-500/10',   badgeText: 'text-amber-600 dark:text-amber-400',     label: 'CMN'   },
  OTHER: { badge: 'bg-violet-500/10',  badgeText: 'text-violet-600 dark:text-violet-400',   label: 'Other' },
}

const ORDER_CONFIG = [
  { key: 'firstOrder'  as const, label: '1st Order', sub: 'Direct compliance obligations',    accentBar: 'bg-[#006494]',  accentBadge: 'bg-[#006494]/10 text-[#006494] dark:text-blue-300'   },
  { key: 'secondOrder' as const, label: '2nd Order', sub: 'Indirectly affected players',      accentBar: 'bg-emerald-500', accentBadge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  { key: 'thirdOrder'  as const, label: '3rd Order', sub: 'Ecosystem & startup implications', accentBar: 'bg-violet-500',  accentBadge: 'bg-violet-500/10 text-violet-700 dark:text-violet-300'  },
]

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).replace(' ', '/')
}

type ImpactDraft  = { sectorOrType: string; why: string }
type ImpactsDraft = { firstOrder: ImpactDraft[]; secondOrder: ImpactDraft[]; thirdOrder: ImpactDraft[] }
const emptyImpact  = (): ImpactDraft  => ({ sectorOrType: '', why: '' })
const emptyImpacts = (): ImpactsDraft => ({ firstOrder: [emptyImpact()], secondOrder: [emptyImpact()], thirdOrder: [emptyImpact()] })

function regToForm(reg: Regulation) {
  return {
    id: reg.id, name: reg.name, shortName: reg.shortName,
    issuer: reg.issuer, date: reg.date,
    description: reg.description, fullContext: reg.fullContext ?? '',
    whatChanged: reg.whatChanged ?? '', officialUrl: reg.officialUrl ?? '',
    tags: reg.tags ?? [] as string[],
  }
}
function regToImpactsDraft(reg: Regulation): ImpactsDraft {
  const toDraft = (arr: ImpactEntry[]) => arr.length ? arr.map(e => ({ ...e })) : [emptyImpact()]
  return {
    firstOrder:  toDraft(reg.impacts.firstOrder),
    secondOrder: toDraft(reg.impacts.secondOrder),
    thirdOrder:  toDraft(reg.impacts.thirdOrder),
  }
}

function ImpactSection({ title, sub, entries, onChange }: {
  title: string; sub: string; entries: ImpactDraft[]; onChange: (e: ImpactDraft[]) => void
}) {
  const update = (i: number, field: keyof ImpactDraft, val: string) =>
    onChange(entries.map((e, idx) => idx === i ? { ...e, [field]: val } : e))
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold">{title}</p>
          <p className="text-[10px] text-muted-foreground">{sub}</p>
        </div>
        <button type="button" onClick={() => onChange([...entries, emptyImpact()])}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      {entries.map((e, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-start">
          <input value={e.sectorOrType} onChange={ev => update(i, 'sectorOrType', ev.target.value)}
            placeholder="Sector / type" className="input-field" />
          <input value={e.why} onChange={ev => update(i, 'why', ev.target.value)}
            placeholder="Why affected" className="input-field" />
          {entries.length > 1 && (
            <button type="button" onClick={() => onChange(entries.filter((_, idx) => idx !== i))}
              className="mt-1 text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

type FormState = ReturnType<typeof regToForm>

function RegulationForm({
  initial, initialImpacts, title, subtitle, submitLabel, onSubmit, onClose, saving,
}: {
  initial: FormState; initialImpacts: ImpactsDraft
  title: string; subtitle: string; submitLabel: string; saving?: boolean
  onSubmit: (reg: Regulation) => void; onClose: () => void
}) {
  const [form, setForm]       = useState<FormState>(initial)
  const [impacts, setImpacts] = useState<ImpactsDraft>(initialImpacts)
  const [errors, setErrors]   = useState<Record<string, string>>({})
  const set = (k: string, v: string | string[]) => setForm(f => ({ ...f, [k]: v }))
  const toggleTag = (t: string) =>
    set('tags', form.tags.includes(t) ? form.tags.filter(x => x !== t) : [...form.tags, t])

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim())        e.name        = 'Required'
    if (!form.shortName.trim())   e.shortName   = 'Required'
    if (!form.date)               e.date        = 'Required'
    if (!form.description.trim()) e.description = 'Required'
    return e
  }

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault()
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    onSubmit({
      ...form,
      id: form.id.trim() || `manual-${Date.now()}`,
      impacts: {
        firstOrder:  impacts.firstOrder.filter(x => x.sectorOrType) as ImpactEntry[],
        secondOrder: impacts.secondOrder.filter(x => x.sectorOrType) as ImpactEntry[],
        thirdOrder:  impacts.thirdOrder.filter(x => x.sectorOrType) as ImpactEntry[],
      },
    })
  }

  const backdropRef = useRef<HTMLDivElement>(null)
  const onBackdrop  = (e: React.MouseEvent) => { if (e.target === backdropRef.current) onClose() }

  return (
    <div ref={backdropRef} onClick={onBackdrop}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="relative w-full max-w-2xl bg-background border rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <p className="font-semibold text-sm">{title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div className="space-y-1">
            <label className="form-label">Full name <span className="text-destructive">*</span></label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Resolução BCB 1 (PIX)" className="input-field w-full" />
            {errors.name && <p className="text-[10px] text-destructive">{errors.name}</p>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="form-label">Short name <span className="text-destructive">*</span></label>
              <input value={form.shortName} onChange={e => set('shortName', e.target.value)}
                placeholder="e.g. PIX" className="input-field w-full" />
              {errors.shortName && <p className="text-[10px] text-destructive">{errors.shortName}</p>}
            </div>
            <div className="space-y-1">
              <label className="form-label">ID <span className="text-muted-foreground text-[10px]">(auto if empty)</span></label>
              <input value={form.id} onChange={e => set('id', e.target.value)}
                placeholder="e.g. res-bcb-1-2020" className="input-field w-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="form-label">Issuer</label>
              <select value={form.issuer} onChange={e => set('issuer', e.target.value)} className="input-field w-full">
                {(['BCB','CMN','CVM','OTHER'] as Issuer[]).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="form-label">Date <span className="text-destructive">*</span></label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className="input-field w-full" />
              {errors.date && <p className="text-[10px] text-destructive">{errors.date}</p>}
            </div>
            <div className="space-y-1 col-span-2 sm:col-span-1">
              <label className="form-label">Official URL</label>
              <input value={form.officialUrl} onChange={e => set('officialUrl', e.target.value)}
                placeholder="https://bcb.gov.br/..." className="input-field w-full" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="form-label">Description <span className="text-destructive">*</span></label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={2} placeholder="Brief description" className="input-field w-full resize-none" />
            {errors.description && <p className="text-[10px] text-destructive">{errors.description}</p>}
          </div>
          <div className="space-y-1">
            <label className="form-label">Full context</label>
            <textarea value={form.fullContext} onChange={e => set('fullContext', e.target.value)}
              rows={2} placeholder="Broader regulatory context" className="input-field w-full resize-none" />
          </div>
          <div className="space-y-1">
            <label className="form-label">What changed</label>
            <input value={form.whatChanged} onChange={e => set('whatChanged', e.target.value)}
              placeholder="What changed vs. prior regime" className="input-field w-full" />
          </div>
          <div className="space-y-2">
            <label className="form-label">Topics</label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_TAGS.map(t => {
                const active = form.tags.includes(t)
                const c = TAG_COLORS[t]
                return (
                  <button type="button" key={t} onClick={() => toggleTag(t)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                      active ? `${c.bg} ${c.text} ${c.border}` : 'text-muted-foreground border-border hover:text-foreground'
                    }`}>{t}</button>
                )
              })}
            </div>
          </div>
          <div className="space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Impact Analysis <span className="font-normal normal-case">(optional)</span>
            </p>
            <ImpactSection title="1st Order" sub="Direct compliance obligations"
              entries={impacts.firstOrder} onChange={v => setImpacts(i => ({ ...i, firstOrder: v }))} />
            <Separator />
            <ImpactSection title="2nd Order" sub="Indirectly affected players"
              entries={impacts.secondOrder} onChange={v => setImpacts(i => ({ ...i, secondOrder: v }))} />
            <Separator />
            <ImpactSection title="3rd Order" sub="Ecosystem & startup implications"
              entries={impacts.thirdOrder} onChange={v => setImpacts(i => ({ ...i, thirdOrder: v }))} />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={onClose} disabled={saving}
              className="h-8 px-4 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="h-8 px-4 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5">
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddRegulationModal({ onAdd, onClose }: { onAdd: (reg: Regulation) => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false)
  const blankForm: FormState = {
    id: '', name: '', shortName: '', issuer: 'BCB', date: '',
    description: '', fullContext: '', whatChanged: '', officialUrl: '', tags: [],
  }
  const handleAdd = async (reg: Regulation) => {
    setSaving(true)
    try {
      const res = await fetch('/api/regulacoes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reg),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const saved: Regulation = await res.json()
      onAdd(saved)
      toast.success('Regulation added')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }
  return (
    <RegulationForm
      initial={blankForm} initialImpacts={emptyImpacts()}
      title="Add Regulation" subtitle="Fill in the fields below to add a regulation manually"
      submitLabel="Add regulation" saving={saving} onSubmit={handleAdd} onClose={onClose}
    />
  )
}

function EditRegulationModal({ reg, onSave, onClose }: {
  reg: Regulation; onSave: (updated: Regulation) => void; onClose: () => void
}) {
  const [saving, setSaving] = useState(false)
  const handleSave = async (updated: Regulation) => {
    setSaving(true)
    try {
      const res = await fetch('/api/regulacoes', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const saved: Regulation = await res.json()
      onSave(saved)
      toast.success('Regulation saved')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }
  return (
    <RegulationForm
      initial={regToForm(reg)} initialImpacts={regToImpactsDraft(reg)}
      title="Edit Regulation" subtitle={`Editing: ${reg.shortName}`}
      submitLabel="Save changes" saving={saving} onSubmit={handleSave} onClose={onClose}
    />
  )
}

// ─── FetchYearModal ───────────────────────────────────────────────────────────
function FetchYearModal({ onFetched, onClose }: {
  onFetched: (regs: Regulation[]) => void; onClose: () => void
}) {
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: currentYear - 2016 }, (_, i) => currentYear - i)
  const [year, setYear]       = useState(currentYear)
  const [loading, setLoading] = useState(false)
  const backdropRef = useRef<HTMLDivElement>(null)
  const onBackdrop  = (e: React.MouseEvent) => { if (e.target === backdropRef.current) onClose() }

  const handleFetch = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/regulacoes/fetch-year', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const { inserted, skipped } = await res.json()
      toast.success(`${year}: ${inserted} added, ${skipped} already existed`)
      const listRes = await fetch('/api/regulacoes')
      const all: Regulation[] = await listRes.json()
      onFetched(all)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={backdropRef} onClick={onBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm bg-background border rounded-xl shadow-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-sm">Fetch regulations by year</p>
            <p className="text-xs text-muted-foreground mt-0.5">Claude will search for BCB/CVM/CMN regulations published that year and save them to the database.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors ml-3 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-1">
          <label className="form-label">Year</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="input-field w-full">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={loading}
            className="h-8 px-4 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-50">Cancel</button>
          <button onClick={handleFetch} disabled={loading}
            className="h-8 px-4 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5">
            {loading ? <><Loader2 className="h-3 w-3 animate-spin" /> Fetching...</> : <><Sparkles className="h-3 w-3" /> Fetch {year}</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Multiselect ──────────────────────────────────────────────────────────────
function MultiSelect({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  const count  = selected.length
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 h-8 px-3 rounded-md text-xs font-medium border border-border bg-muted hover:bg-muted/80 text-foreground transition-colors"
      >
        <span>{label}</span>
        {count > 0 && (
          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-foreground text-[10px] font-bold text-background">
            {count}
          </span>
        )}
        <SlidersHorizontal className="h-3 w-3 opacity-50" />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-52 rounded-lg border border-border shadow-xl overflow-hidden bg-popover">
          <div className="p-1.5 space-y-0.5 max-h-72 overflow-y-auto">
            {options.map(opt => (
              <button key={opt} onClick={() => toggle(opt)}
                className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <span>{opt}</span>
                {selected.includes(opt) && <Check className="h-3 w-3 text-foreground" />}
              </button>
            ))}
          </div>
          {count > 0 && (<>
            <div className="h-px bg-border" />
            <button onClick={() => { onChange([]); setOpen(false) }}
              className="w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground text-center transition-colors">
              Clear all
            </button>
          </>)}
        </div>
      )}
    </div>
  )
}

// ─── Filter bar ───────────────────────────────────────────────────────────────
function FilterBar({ activeTags, onTagsChange, activeYears, onYearsChange, years, totalCount, filteredCount, onAdd, onFetchYear }: {
  activeTags: Tag[]; onTagsChange: (t: Tag[]) => void
  activeYears: string[]; onYearsChange: (y: string[]) => void
  years: string[]; totalCount: number; filteredCount: number
  onAdd: () => void; onFetchYear: () => void
}) {
  const hasFilters = activeTags.length > 0 || activeYears.length > 0
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <p className="text-xs text-muted-foreground">
        Showing <span className="text-foreground font-medium">{filteredCount}</span> of {totalCount}
      </p>
      <div className="w-px h-4 bg-border" />
      {hasFilters && (
        <button
          onClick={() => { onTagsChange([]); onYearsChange([]) }}
          className="flex items-center gap-1 h-8 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground border border-border hover:bg-muted transition-colors"
        >
          <X className="h-3 w-3" /> Clear
        </button>
      )}
      <MultiSelect label="Year"  options={years}          selected={activeYears}           onChange={onYearsChange} />
      <MultiSelect label="Topic" options={[...ALL_TAGS]}  selected={activeTags as string[]} onChange={v => onTagsChange(v as Tag[])} />
      <div className="w-px h-4 bg-border" />
      <button
        onClick={onFetchYear}
        className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-border hover:bg-muted transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5" /> Fetch year
      </button>
      <button
        onClick={onAdd}
        className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
    </div>
  )
}

// ─── Timeline ─────────────────────────────────────────────────────────────────
// Dot size: 18px (Tailwind spacing-4.5 = 1.125rem)
const DOT_SIZE = 18

function TimelineSkeleton() {
  return (
    <div className="border rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800/40">
      <div className="flex gap-3 px-5 pt-8 pb-5 animate-pulse">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center">
            <div
              className="rounded-full border-2 border-black bg-muted mb-2"
              style={{ width: DOT_SIZE, height: DOT_SIZE }}
            />
            <div className="min-w-[148px] border border-black rounded-lg p-3 space-y-2 bg-white dark:bg-slate-700">
              <div className="h-3 bg-muted rounded w-16" />
              <div className="h-3 bg-muted rounded w-24" />
              <div className="h-3 bg-muted rounded w-16 mt-auto" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RegulationsTimeline({ regulations, onEdit }: { regulations: Regulation[]; onEdit: (reg: Regulation) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragStart  = useRef({ x: 0, scrollLeft: 0 })
  const [dragging, setDragging] = useState(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isDragging.current = true
    setDragging(true)
    dragStart.current = { x: e.clientX, scrollLeft: scrollRef.current?.scrollLeft ?? 0 }
    e.preventDefault()
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current || !scrollRef.current) return
    scrollRef.current.scrollLeft = dragStart.current.scrollLeft - (e.clientX - dragStart.current.x)
  }, [])

  const onMouseUp = useCallback(() => { isDragging.current = false; setDragging(false) }, [])

  useEffect(() => {
    const stop = () => { isDragging.current = false; setDragging(false) }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  const scrollToStart = useCallback(() => {
    scrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' })
  }, [])

  const scrollToEnd = useCallback(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTo({ left: scrollRef.current.scrollWidth, behavior: 'smooth' })
  }, [])

  const selected = regulations.find(r => r.id === selectedId) ?? null

  if (regulations.length === 0)
    return (
      <div className="border rounded-xl p-10 text-center space-y-2">
        <p className="text-sm text-muted-foreground">No regulations yet.</p>
        <p className="text-xs text-muted-foreground">Use <span className="font-medium">Fetch year</span> to populate the database.</p>
      </div>
    )

  // Horizontal line sits exactly at the vertical center of the dot.
  // pt-8 = 32px, then line top = 32px + DOT_SIZE/2 = 32 + 9 = 41px
  const lineTop = `calc(2rem + ${DOT_SIZE / 2}px)`

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="relative">
        {/* Left arrow */}
        <button
          onClick={scrollToStart}
          className="absolute left-0 top-0 bottom-0 z-20 flex items-center justify-center w-8 bg-gradient-to-r from-slate-100 dark:from-slate-800 to-transparent hover:from-slate-200 dark:hover:from-slate-700 transition-colors"
          aria-label="Scroll to first event"
        >
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        </button>

        {/* Right arrow */}
        <button
          onClick={scrollToEnd}
          className="absolute right-0 top-0 bottom-0 z-20 flex items-center justify-center w-8 bg-gradient-to-l from-slate-100 dark:from-slate-800 to-transparent hover:from-slate-200 dark:hover:from-slate-700 transition-colors"
          aria-label="Scroll to last event"
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>

        <div
          ref={scrollRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          className="overflow-x-auto bg-slate-100 dark:bg-slate-800/40"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}
        >
          <div className="relative flex items-start gap-3 px-10 pt-8 pb-5 min-w-max">
            {/* Horizontal line: top is aligned to the vertical center of every dot */}
            <div
              className="absolute left-10 right-10 bg-border dark:bg-slate-600 pointer-events-none"
              style={{ top: lineTop, height: '1px' }}
            />

            {regulations.map(reg => {
              const c = getRegColor(reg)
              const isSelected = selectedId === reg.id
              return (
                <div key={reg.id} className="relative flex flex-col items-center">
                  {/* Dot: 18×18px — matches lineTop calculation */}
                  <div
                    className={`relative z-10 mb-2 rounded-full shrink-0 border-2 border-black ${c.dot}`}
                    style={{ width: DOT_SIZE, height: DOT_SIZE }}
                  />
                  <button
                    onClick={() => !dragging && setSelectedId(isSelected ? null : reg.id)}
                    className={`flex flex-col gap-2 text-left rounded-lg border border-black p-3 min-w-[148px] max-w-[148px] transition-all duration-150 ${
                      isSelected ? `${c.bg} ${c.border} shadow-sm` : 'bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600'
                    }`}
                    style={{ pointerEvents: 'auto' }}
                  >
                    <span className="text-[10px] text-muted-foreground tabular-nums">{fmtDate(reg.date)}</span>
                    <p className="text-xs font-medium leading-snug line-clamp-3">{reg.shortName}</p>
                    {reg.tags?.[0] && (
                      <span className={`self-start text-[9px] font-medium px-1.5 py-0.5 rounded-full ${c.bg} ${c.text} mt-auto`}>
                        {reg.tags[0]}
                      </span>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {selected && (() => {
        const c = getRegColor(selected)
        const s = ISSUER_STYLES[selected.issuer]
        return (
          <div className={`border-t px-5 py-4 space-y-3 ${c.bg}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`${s.badge} ${s.badgeText} border-0 text-xs`}>{s.label}</Badge>
                  {selected.tags?.map(t => {
                    const tc = TAG_COLORS[t as Tag] ?? DEFAULT_COLOR
                    return <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${tc.bg} ${tc.text}`}>{t}</span>
                  })}
                </div>
                <p className="font-semibold text-sm">{selected.name}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(selected.date)}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => onEdit(selected)} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{selected.description}</p>
            {selected.whatChanged && (
              <div className="bg-background/60 rounded-md px-3 py-2 text-xs">
                <span className="font-medium text-foreground">What changed: </span>
                <span className="text-muted-foreground">{selected.whatChanged}</span>
              </div>
            )}
            {selected.officialUrl && (
              <a href={selected.officialUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                <ExternalLink className="h-3 w-3" /> View official text
              </a>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ─── Latest cards ─────────────────────────────────────────────────────────────
function LatestRegulationsCards({ regulations, onEdit }: { regulations: Regulation[]; onEdit: (r: Regulation) => void }) {
  if (regulations.length === 0) return null
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
      {regulations.map(reg => {
        const s = ISSUER_STYLES[reg.issuer]
        return (
          <Card key={reg.id} className="flex flex-col h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <Badge className={`${s.badge} ${s.badgeText} border-0 text-xs`}>{s.label}</Badge>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">{fmtDate(reg.date)}</span>
                  <button onClick={() => onEdit(reg)} className="text-muted-foreground hover:text-foreground transition-colors ml-1">
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <p className="font-semibold text-sm mt-2 leading-snug">{reg.name}</p>
              <div className="flex gap-1 flex-wrap mt-1.5">
                {reg.tags?.map(t => {
                  const tc = TAG_COLORS[t as Tag] ?? DEFAULT_COLOR
                  return <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${tc.bg} ${tc.text}`}>{t}</span>
                })}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col flex-1 gap-0 pt-0">
              <p className="text-sm text-muted-foreground flex-1">{reg.fullContext}</p>
              <div className="mt-4 bg-muted rounded-md px-3 py-2 text-xs">
                <span className="font-medium text-foreground">What changed: </span>
                <span className="text-muted-foreground">{reg.whatChanged}</span>
              </div>
              {reg.officialUrl && (
                <a href={reg.officialUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 mt-3 hover:underline">
                  <ExternalLink className="h-3 w-3" /> View official text
                </a>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Impact analysis ──────────────────────────────────────────────────────────
function ImpactFilterSection({ regulations, onEdit }: { regulations: Regulation[]; onEdit: (r: Regulation) => void }) {
  const [selectedId, setSelectedId] = useState(regulations[regulations.length - 1]?.id ?? '')
  const reg = regulations.find(r => r.id === selectedId)
  if (regulations.length === 0) return <p className="text-sm text-muted-foreground">No regulations to analyse yet.</p>
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-full md:w-80"><SelectValue placeholder="Select a regulation" /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Regulations</SelectLabel>
              {regulations.map(r => (
                <SelectItem key={r.id} value={r.id}>{r.shortName} – {r.date.slice(0,4)}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {reg && (
          <button onClick={() => onEdit(reg)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
      </div>
      {reg && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ORDER_CONFIG.map(order => (
            <div key={order.key} className="border rounded-lg overflow-hidden">
              <div className={`h-1 w-full ${order.accentBar}`} />
              <div className="p-4 space-y-3">
                <div>
                  <p className="font-semibold text-sm">{order.label}</p>
                  <p className="text-xs text-muted-foreground">{order.sub}</p>
                </div>
                <Separator />
                {reg.impacts[order.key].length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No entries</p>
                )}
                {reg.impacts[order.key].map((entry, i) => (
                  <div key={i} className="space-y-1">
                    <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${order.accentBadge}`}>
                      {entry.sectorOrType}
                    </span>
                    <p className="text-xs text-muted-foreground">{entry.why}</p>
                    {i < reg.impacts[order.key].length - 1 && <Separator className="mt-2" />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export function RegulacoesBRClient() {
  const [regulations, setRegulations] = useState<Regulation[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [activeTags, setActiveTags]   = useState<Tag[]>([])
  const [activeYears, setActiveYears] = useState<string[]>([])
  const [showAdd, setShowAdd]         = useState(false)
  const [showFetchYear, setShowFetchYear] = useState(false)
  const [editingReg, setEditingReg]   = useState<Regulation | null>(null)

  const loadRegs = useCallback(() => {
    setLoading(true)
    fetch('/api/regulacoes')
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
        return r.json()
      })
      .then((data: Regulation[]) => { setRegulations(data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(() => { loadRegs() }, [loadRegs])

  const handleSave = useCallback((updated: Regulation) => {
    setRegulations(prev => prev.map(r => r.id === updated.id ? updated : r))
  }, [])

  const handleAdd = useCallback((reg: Regulation) => {
    setRegulations(prev => [...prev, reg].sort((a, b) => a.date.localeCompare(b.date)))
  }, [])

  const years = useMemo(() =>
    Array.from(new Set(regulations.map(r => r.date.slice(0, 4)))).sort()
  , [regulations])

  const filtered = useMemo(() =>
    regulations.filter(r => {
      if (activeTags.length  > 0 && !activeTags.some(t => r.tags?.includes(t)))  return false
      if (activeYears.length > 0 && !activeYears.includes(r.date.slice(0, 4)))   return false
      return true
    })
  , [regulations, activeTags, activeYears])

  const latestThree = useMemo(
    () => [...filtered].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3),
    [filtered]
  )

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 space-y-8">
      <style>{`
        .input-field { display:block; font-size:0.75rem; background:hsl(var(--background)); border:1px solid hsl(var(--border)); border-radius:0.375rem; padding:0.375rem 0.75rem; outline:none; }
        .input-field:focus { box-shadow:0 0 0 2px hsl(var(--ring)/0.4); }
        .form-label  { display:block; font-size:0.75rem; font-weight:500; margin-bottom:0.25rem; }
      `}</style>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Regulatory Timeline</h1>
          <p className="text-sm text-muted-foreground">Banco Central do Brasil · CVM · CMN</p>
        </div>
        {!loading && !error && (
          <FilterBar
            activeTags={activeTags}   onTagsChange={setActiveTags}
            activeYears={activeYears} onYearsChange={setActiveYears}
            years={years} totalCount={regulations.length} filteredCount={filtered.length}
            onAdd={() => setShowAdd(true)}
            onFetchYear={() => setShowFetchYear(true)}
          />
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Failed to load regulations</p>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{error}</p>
          </div>
        </div>
      )}

      <section>
        <h2 className="text-base font-semibold mb-4">Timeline</h2>
        {loading ? <TimelineSkeleton /> : <RegulationsTimeline regulations={filtered} onEdit={setEditingReg} />}
      </section>

      <section>
        <h2 className="text-base font-semibold mb-4">Latest 3 Regulations</h2>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse border rounded-lg p-4 space-y-3">
                <div className="h-4 bg-muted rounded w-20" />
                <div className="h-4 bg-muted rounded w-40" />
                <div className="h-20 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : <LatestRegulationsCards regulations={latestThree} onEdit={setEditingReg} />}
      </section>

      <section>
        <h2 className="text-base font-semibold mb-1">Impact Analysis</h2>
        <p className="text-sm text-muted-foreground mb-4">Select a regulation to view first, second, and third-order implications.</p>
        {loading
          ? <div className="animate-pulse h-10 bg-muted rounded w-80" />
          : <ImpactFilterSection regulations={filtered} onEdit={setEditingReg} />}
      </section>

      {showAdd && (
        <AddRegulationModal onAdd={handleAdd} onClose={() => setShowAdd(false)} />
      )}
      {showFetchYear && (
        <FetchYearModal
          onFetched={setRegulations}
          onClose={() => setShowFetchYear(false)}
        />
      )}
      {editingReg && (
        <EditRegulationModal
          reg={editingReg}
          onSave={handleSave}
          onClose={() => setEditingReg(null)}
        />
      )}
    </div>
  )
}
