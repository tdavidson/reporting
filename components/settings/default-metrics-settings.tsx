'use client'

// Fund-wide default metric profile: metrics an admin defines once that get seeded into every
// portfolio company (existing companies via "Sync"/on-create; new companies automatically at
// creation). Templates are seed-only — editing or removing one here never touches metrics already
// copied into a company. Dedup on apply is by slug, so a company already tracking a slug is skipped.

import { useEffect, useState } from 'react'
import { Loader2, Plus, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { SettingsCard, SettingsCardGrid } from '@/components/settings-card'
import { MetricForm } from '@/components/metric-form'

interface DefaultMetric {
  id: string
  name: string
  slug: string
  description: string | null
  unit: string | null
  unit_position: 'prefix' | 'suffix' | string | null
  value_type: 'number' | 'currency' | 'percentage' | 'text' | string | null
  reporting_cadence: 'quarterly' | 'monthly' | 'annual' | string | null
  display_order: number | null
  is_active: boolean | null
  currency: string | null
}

const ENDPOINTS = {
  create: '/api/default-metrics',
  update: (id: string) => `/api/default-metrics/${id}`,
}

export function DefaultMetricsSettings() {
  const [metrics, setMetrics] = useState<DefaultMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<DefaultMetric | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  function load() {
    setLoading(true)
    fetch('/api/default-metrics')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setMetrics(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(null), 5000)
  }

  async function remove(id: string) {
    setMetrics(prev => prev.filter(m => m.id !== id)) // optimistic
    await fetch(`/api/default-metrics/${id}`, { method: 'DELETE' })
  }

  async function sync() {
    setSyncing(true)
    const res = await fetch('/api/default-metrics/apply', { method: 'POST' })
    setSyncing(false)
    if (res.ok) {
      const { inserted, companies } = await res.json()
      flash(inserted === 0
        ? `All ${companies} companies are already up to date.`
        : `Added ${inserted} metric${inserted === 1 ? '' : 's'} across ${companies} companies.`)
    } else {
      flash('Sync failed.')
    }
  }

  return (
    <>
      <p className="mb-4 text-xs text-muted-foreground">
        Metrics defined here are applied to <strong>every portfolio company</strong> — existing ones when you
        add or sync, and any new company automatically at creation. A company already tracking a metric with the
        same slug is skipped, so you never get duplicates. Removing a metric here does not delete it from companies
        that already have it.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : metrics.length === 0 ? (
        <div className="rounded-md border px-3 py-4 text-xs text-muted-foreground">
          No default metrics yet. Add one below to track it across all companies.
        </div>
      ) : (
        <SettingsCardGrid>
          {metrics.map(m => (
            <SettingsCard
              key={m.id}
              muted={m.is_active === false}
              title={m.name}
              subtitle={
                <span className="font-mono">
                  {m.slug}
                  {m.unit ? ` · ${m.unit}` : ''}
                  {m.value_type && m.value_type !== 'number' ? ` · ${m.value_type}` : ''}
                </span>
              }
              aside={
                <>
                  <button onClick={() => setEditing(m)} className="text-xs text-muted-foreground hover:text-foreground">Edit</button>
                  <button onClick={() => remove(m.id)} className="text-xs text-muted-foreground hover:text-destructive">Remove</button>
                </>
              }
            >
              {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}
            </SettingsCard>
          ))}
        </SettingsCardGrid>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add default metric
        </Button>
        {metrics.length > 0 && (
          <Button variant="ghost" size="sm" onClick={sync} disabled={syncing}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
            Sync to all companies
          </Button>
        )}
        {notice && <span className="text-xs text-muted-foreground">{notice}</span>}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add default metric</DialogTitle>
            <DialogDescription>Applied to every company. Companies already tracking this slug are skipped.</DialogDescription>
          </DialogHeader>
          <MetricForm
            endpoints={ENDPOINTS}
            submitLabel="Add to all companies"
            onSuccess={(data: any) => {
              setAddOpen(false)
              load()
              const applied = data?.applied
              if (applied) {
                flash(applied.inserted === 0
                  ? `Added to the profile. All ${applied.companies} companies already tracked it.`
                  : `Added to ${applied.inserted} of ${applied.companies} companies.`)
              }
            }}
            onCancel={() => setAddOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit default metric</DialogTitle>
            <DialogDescription>Changes affect only the profile and future companies — metrics already on companies are left as-is.</DialogDescription>
          </DialogHeader>
          {editing && (
            <MetricForm
              endpoints={ENDPOINTS}
              metric={editing}
              onSuccess={() => { setEditing(null); load() }}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
