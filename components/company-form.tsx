'use client'

import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { X } from 'lucide-react'
import type { Company } from '@/lib/types/database'

interface Props {
  company?: Company
  initialName?: string
  onSuccess: (company: Company) => void
  onCancel: () => void
}

/** A fund-wide default metric template, as returned by GET /api/default-metrics. */
interface DefaultMetric {
  id: string
  name: string
  unit: string | null
  description: string | null
  is_active: boolean | null
}

interface CustomMetric {
  name: string
  unit: string | null
}

/** A fund vehicle, as returned by GET /api/vehicles. */
interface Vehicle {
  id: string
  name: string
  kind: string
  aliases: string[] | null
  active: boolean
}

export function CompanyForm({ company, initialName, onSuccess, onCancel }: Props) {
  const isEdit = !!company

  const [name, setName] = useState(company?.name ?? initialName ?? '')
  const [aliases, setAliases] = useState<string[]>(company?.aliases ?? [])
  const [aliasInput, setAliasInput] = useState('')
  const [stage, setStage] = useState(company?.stage ?? '')
  const [industries, setIndustries] = useState<string[]>(company?.industry ?? [])
  const [industryInput, setIndustryInput] = useState('')
  const [tags, setTags] = useState<string[]>(company?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [portfolioGroups, setPortfolioGroups] = useState<string[]>(company?.portfolio_group ?? [])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [vehicleInput, setVehicleInput] = useState('')
  const [vehicleDropdownOpen, setVehicleDropdownOpen] = useState(false)
  const [vehicleCreating, setVehicleCreating] = useState(false)
  const vehicleFieldRef = useRef<HTMLDivElement>(null)
  const [notes, setNotes] = useState(company?.notes ?? '')
  const [overview, setOverview] = useState(company?.overview ?? '')
  const [founders, setFounders] = useState(company?.founders ?? '')
  const [whyInvested, setWhyInvested] = useState(company?.why_invested ?? '')
  const [currentUpdate, setCurrentUpdate] = useState(company?.current_update ?? '')
  const [contactEmails, setContactEmails] = useState<string[]>(company?.contact_email ?? [])
  const [contactEmailInput, setContactEmailInput] = useState('')
  const [status, setStatus] = useState(company?.status ?? 'active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Metrics, create-mode only. The fund's default profile has always been copied in on create;
  // this exposes it so you can uncheck the ones that don't apply and add one-offs up front,
  // instead of creating the company and then fixing its metric list on the company page.
  const [defaults, setDefaults] = useState<DefaultMetric[] | null>(null)
  const [keptDefaults, setKeptDefaults] = useState<Set<string>>(new Set())
  const [customMetrics, setCustomMetrics] = useState<CustomMetric[]>([])
  const [customName, setCustomName] = useState('')
  const [customUnit, setCustomUnit] = useState('')

  useEffect(() => {
    if (isEdit) return
    let cancelled = false
    fetch('/api/default-metrics')
      .then(res => (res.ok ? res.json() : []))
      .then((rows: DefaultMetric[]) => {
        if (cancelled) return
        const active = (rows ?? []).filter(d => d.is_active !== false)
        setDefaults(active)
        setKeptDefaults(new Set(active.map(d => d.id)))
      })
      .catch(() => { if (!cancelled) setDefaults([]) })
    return () => { cancelled = true }
  }, [isEdit])

  useEffect(() => {
    let cancelled = false
    fetch('/api/vehicles')
      .then(res => (res.ok ? res.json() : []))
      .then((data: Vehicle[] | { vehicles: Vehicle[] }) => {
        if (cancelled) return
        const rows = Array.isArray(data) ? data : (data?.vehicles ?? [])
        setVehicles(rows)
      })
      .catch(() => { if (!cancelled) setVehicles([]) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (vehicleFieldRef.current && !vehicleFieldRef.current.contains(e.target as Node)) {
        setVehicleDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function toggleDefault(id: string) {
    setKeptDefaults(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addCustomMetric() {
    const trimmed = customName.trim()
    if (!trimmed) return
    if (customMetrics.some(m => m.name.toLowerCase() === trimmed.toLowerCase())) return
    setCustomMetrics(prev => [...prev, { name: trimmed, unit: customUnit.trim() || null }])
    setCustomName('')
    setCustomUnit('')
  }

  function handleCustomMetricKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addCustomMetric() }
  }

  function addTag() {
    const trimmed = tagInput.trim()
    if (!trimmed || tags.includes(trimmed)) return
    setTags(prev => [...prev, trimmed])
    setTagInput('')
  }

  function removeTag(tag: string) {
    setTags(prev => prev.filter(t => t !== tag))
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    }
  }

  function addIndustry() {
    const trimmed = industryInput.trim()
    if (!trimmed || industries.includes(trimmed)) return
    setIndustries(prev => [...prev, trimmed])
    setIndustryInput('')
  }

  function removeIndustry(val: string) {
    setIndustries(prev => prev.filter(v => v !== val))
  }

  function handleIndustryKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addIndustry() }
  }

  function removePortfolioGroup(val: string) {
    setPortfolioGroups(prev => prev.filter(v => v !== val))
  }

  const vehicleMatches = vehicles.filter(v =>
    v.name.toLowerCase().includes(vehicleInput.trim().toLowerCase()) &&
    !portfolioGroups.includes(v.name)
  )
  const vehicleExactMatch = vehicles.some(
    v => v.name.toLowerCase() === vehicleInput.trim().toLowerCase()
  )

  function selectVehicle(name: string) {
    if (!portfolioGroups.includes(name)) {
      setPortfolioGroups(prev => [...prev, name])
    }
    setVehicleInput('')
    setVehicleDropdownOpen(false)
  }

  async function createAndSelectVehicle(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    setVehicleCreating(true)
    try {
      const res = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, kind: 'other' }),
      })
      if (res.ok) {
        const created: Vehicle = await res.json()
        setVehicles(prev => (prev.some(v => v.id === created.id) ? prev : [...prev, created]))
        selectVehicle(created.name)
      } else if (res.status === 409) {
        // Already exists (e.g. created elsewhere between fetch and submit) — just add the name.
        selectVehicle(trimmed)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to create vehicle')
      }
    } catch {
      setError('Failed to create vehicle')
    } finally {
      setVehicleCreating(false)
    }
  }

  function handleVehicleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const trimmed = vehicleInput.trim()
    if (!trimmed) return
    const existing = vehicles.find(v => v.name.toLowerCase() === trimmed.toLowerCase())
    if (existing) {
      selectVehicle(existing.name)
    } else {
      void createAndSelectVehicle(trimmed)
    }
  }

  function addContactEmail() {
    const trimmed = contactEmailInput.trim()
    if (!trimmed || contactEmails.includes(trimmed)) return
    setContactEmails(prev => [...prev, trimmed])
    setContactEmailInput('')
  }

  function removeContactEmail(val: string) {
    setContactEmails(prev => prev.filter(v => v !== val))
  }

  function handleContactEmailKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addContactEmail() }
  }

  function addAlias() {
    const trimmed = aliasInput.trim()
    if (!trimmed || aliases.includes(trimmed)) return
    setAliases(prev => [...prev, trimmed])
    setAliasInput('')
  }

  function removeAlias(alias: string) {
    setAliases(prev => prev.filter(a => a !== alias))
  }

  function handleAliasKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addAlias()
    }
  }

  async function submit() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setError(null)
    setSaving(true)

    try {
      const url = isEdit ? `/api/companies/${company.id}` : '/api/companies'
      const method = isEdit ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          aliases: aliases.length > 0 ? aliases : null,
          tags: tags.length > 0 ? tags : [],
          stage: stage.trim() || null,
          industry: industries.length > 0 ? industries : null,
          notes: notes.trim() || null,
          overview: overview.trim() || null,
          founders: founders.trim() || null,
          why_invested: whyInvested.trim() || null,
          current_update: currentUpdate.trim() || null,
          contact_email: contactEmails.length > 0 ? contactEmails : null,
          portfolio_group: portfolioGroups.length > 0 ? portfolioGroups : null,
          ...(isEdit
            ? { status }
            : {
                // Only send a selection once the defaults have loaded — otherwise omit both keys
                // and the server seeds every active default, the long-standing behaviour.
                ...(defaults ? { default_metric_ids: Array.from(keptDefaults) } : {}),
                ...(customMetrics.length > 0 ? { custom_metrics: customMetrics } : {}),
              }),
        }),
      })

      const text = await res.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(`Server error (${res.status}): failed to parse response`)
      }
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
      onSuccess(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="company-name">Name</Label>
        <Input
          id="company-name"
          placeholder="Acme Corp"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Aliases</Label>
        {aliases.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {aliases.map(alias => (
              <Badge key={alias} variant="secondary" className="gap-1 pr-1">
                {alias}
                <button
                  type="button"
                  onClick={() => removeAlias(alias)}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <Input
          placeholder="Add alias and press Enter"
          value={aliasInput}
          onChange={e => setAliasInput(e.target.value)}
          onKeyDown={handleAliasKeyDown}
          onBlur={addAlias}
        />
        <p className="text-xs text-muted-foreground">
          Alternative names Claude might see in emails (e.g. abbreviations, trading names).
        </p>
      </div>

      <div className="space-y-2">
        <Label>Tags</Label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tags.map(tag => (
              <Badge key={tag} variant="outline" className="gap-1 pr-1">
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <Input
          placeholder="Add tag and press Enter (e.g. Fund I)"
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={handleTagKeyDown}
          onBlur={addTag}
        />
        <p className="text-xs text-muted-foreground">
          Tags for organizing companies (e.g. fund name, cohort).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="stage">Stage</Label>
        <Input
          id="stage"
          placeholder="Series A"
          value={stage}
          onChange={e => setStage(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Industry</Label>
        {industries.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {industries.map(val => (
              <Badge key={val} variant="outline" className="gap-1 pr-1">
                {val}
                <button
                  type="button"
                  onClick={() => removeIndustry(val)}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <Input
          placeholder="Add industry and press Enter (e.g. SaaS)"
          value={industryInput}
          onChange={e => setIndustryInput(e.target.value)}
          onKeyDown={handleIndustryKeyDown}
          onBlur={addIndustry}
        />
      </div>

      <div className="space-y-2">
        <Label>Vehicles</Label>
        {portfolioGroups.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {portfolioGroups.map(val => (
              <Badge key={val} variant="outline" className="gap-1 pr-1">
                {val}
                <button
                  type="button"
                  onClick={() => removePortfolioGroup(val)}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="relative" ref={vehicleFieldRef}>
          <Input
            placeholder="Search or add a vehicle…"
            value={vehicleInput}
            onChange={e => { setVehicleInput(e.target.value); setVehicleDropdownOpen(true) }}
            onFocus={() => setVehicleDropdownOpen(true)}
            onKeyDown={handleVehicleInputKeyDown}
            disabled={vehicleCreating}
          />
          {vehicleDropdownOpen && vehicleInput.trim() && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-48 overflow-y-auto">
              {vehicleMatches.map(v => (
                <button
                  key={v.id}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); selectVehicle(v.name) }}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-sm text-left hover:bg-muted"
                >
                  <span className="truncate">{v.name}</span>
                  <span className="text-xs text-muted-foreground ml-2 shrink-0">{v.kind}</span>
                </button>
              ))}
              {!vehicleExactMatch && (
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); void createAndSelectVehicle(vehicleInput) }}
                  disabled={vehicleCreating}
                  className="flex w-full items-center px-3 py-1.5 text-sm text-left hover:bg-muted border-t"
                >
                  {vehicleCreating ? 'Creating…' : `Create "${vehicleInput.trim()}"`}
                </button>
              )}
              {vehicleMatches.length === 0 && vehicleExactMatch && (
                <div className="px-3 py-1.5 text-sm text-muted-foreground">Already added</div>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Which fund vehicle(s) this company sits under. Optional — leave empty for a direct deal.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="founders">Founders</Label>
        <Input
          id="founders"
          placeholder="Jane Doe, John Smith"
          value={founders}
          onChange={e => setFounders(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Contact Emails</Label>
        {contactEmails.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {contactEmails.map(val => (
              <Badge key={val} variant="outline" className="gap-1 pr-1">
                {val}
                <button
                  type="button"
                  onClick={() => removeContactEmail(val)}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <Input
          type="email"
          placeholder="Add email and press Enter"
          value={contactEmailInput}
          onChange={e => setContactEmailInput(e.target.value)}
          onKeyDown={handleContactEmailKeyDown}
          onBlur={addContactEmail}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="overview">Overview</Label>
        <Textarea
          id="overview"
          placeholder="Brief description of the company..."
          value={overview}
          onChange={e => setOverview(e.target.value)}
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="why-invested">Why We Invested</Label>
        <Textarea
          id="why-invested"
          placeholder="Investment thesis..."
          value={whyInvested}
          onChange={e => setWhyInvested(e.target.value)}
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="current-update">Current Business Update</Label>
        <Textarea
          id="current-update"
          placeholder="Latest update on the business..."
          value={currentUpdate}
          onChange={e => setCurrentUpdate(e.target.value)}
          rows={2}
        />
      </div>

      {isEdit && (
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="exited">Exited</SelectItem>
              <SelectItem value="written-off">Written off</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          placeholder="Any notes about this company…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
        />
      </div>

      {!isEdit && (
        <div className="space-y-2 border-t pt-4">
          <Label>Metrics</Label>
          {defaults === null ? (
            <p className="text-xs text-muted-foreground">Loading your fund&apos;s default metrics…</p>
          ) : defaults.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Your fund has no default metrics yet. Add any you want to track here, or set a fund-wide
              profile in Settings → Default metrics.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Your fund defaults, applied to this company on create. Uncheck any that don&apos;t apply.
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto rounded-md border p-2">
                {defaults.map(d => (
                  <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      checked={keptDefaults.has(d.id)}
                      onChange={() => toggleDefault(d.id)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate">
                      {d.name}
                      {d.unit ? <span className="text-muted-foreground"> · {d.unit}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}

          {customMetrics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {customMetrics.map(m => (
                <Badge key={m.name} variant="outline" className="gap-1 pr-1">
                  {m.name}{m.unit ? ` · ${m.unit}` : ''}
                  <button
                    type="button"
                    onClick={() => setCustomMetrics(prev => prev.filter(x => x.name !== m.name))}
                    className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Input
              placeholder="Add a metric (e.g. ARR)"
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              onKeyDown={handleCustomMetricKeyDown}
            />
            <Input
              placeholder="Unit"
              value={customUnit}
              onChange={e => setCustomUnit(e.target.value)}
              onKeyDown={handleCustomMetricKeyDown}
              className="w-24"
            />
            <Button type="button" variant="outline" onClick={addCustomMetric} disabled={!customName.trim()}>
              Add
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Values get entered on the company page once it exists.
          </p>
        </div>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add company'}
        </Button>
      </div>
    </div>
  )
}
