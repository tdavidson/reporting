'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { useCurrency, getCurrencySymbol } from '@/components/currency-context'

interface MetricWithValues {
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

interface Props {
  companyId: string
  metric?: MetricWithValues
  onSuccess: (metric: MetricWithValues) => void
  onCancel: () => void
}

function toSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

const CURRENCY_SYMBOLS = new Set(['$', '€', '£', '¥', '₹', '₪', '₩', 'R$', 'C$', 'A$', 'S$', 'NZ$', 'HK$'])

const CURRENCIES = [
  { code: 'USD', label: 'USD ($)' },
  { code: 'EUR', label: 'EUR (€)' },
  { code: 'GBP', label: 'GBP (£)' },
  { code: 'CHF', label: 'CHF' },
  { code: 'CAD', label: 'CAD (C$)' },
  { code: 'AUD', label: 'AUD (A$)' },
  { code: 'JPY', label: 'JPY (¥)' },
  { code: 'CNY', label: 'CNY (¥)' },
  { code: 'INR', label: 'INR (₹)' },
  { code: 'SGD', label: 'SGD (S$)' },
  { code: 'HKD', label: 'HKD (HK$)' },
  { code: 'SEK', label: 'SEK (kr)' },
  { code: 'NOK', label: 'NOK (kr)' },
  { code: 'DKK', label: 'DKK (kr)' },
  { code: 'NZD', label: 'NZD (NZ$)' },
  { code: 'BRL', label: 'BRL (R$)' },
  { code: 'ZAR', label: 'ZAR (R)' },
  { code: 'ILS', label: 'ILS (₪)' },
  { code: 'KRW', label: 'KRW (₩)' },
]

export function MetricForm({ companyId, metric, onSuccess, onCancel }: Props) {
  const isEdit = !!metric
  const fundCurrency = useCurrency()
  const currencySymbol = getCurrencySymbol(fundCurrency).trim()

  const [name, setName] = useState(metric?.name ?? '')
  const [slug, setSlug] = useState(metric?.slug ?? '')
  const [slugManual, setSlugManual] = useState(isEdit)
  const [description, setDescription] = useState(metric?.description ?? '')
  const [unit, setUnit] = useState(metric?.unit ?? '')
  const [unitPosition, setUnitPosition] = useState<'prefix' | 'suffix'>((metric?.unit_position as 'prefix' | 'suffix') ?? 'suffix')
  const [valueType, setValueType] = useState(metric?.value_type ?? 'number')
  const [currency, setCurrency] = useState(metric?.currency ?? '')
  const [displayOrder, setDisplayOrder] = useState(String(metric?.display_order ?? 0))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slugManual) {
      setSlug(toSlug(name))
    }
  }, [name, slugManual])

  async function submit() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (!slug.trim()) {
      setError('Slug is required.')
      return
    }
    setError(null)
    setSaving(true)

    try {
      const url = isEdit ? `/api/metrics/${metric.id}` : `/api/companies/${companyId}/metrics`
      const method = isEdit ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || null,
          unit: unit.trim() === '#' ? null : (unit.trim() || null),
          unit_position: unitPosition,
          value_type: valueType,
          currency: currency || null,
          display_order: parseInt(displayOrder) || 0,
        }),
      })

      const data = await res.json()
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="metric-name">Name</Label>
          <Input
            id="metric-name"
            placeholder="Monthly Recurring Revenue"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="metric-slug">Slug</Label>
          <Input
            id="metric-slug"
            placeholder="monthly_recurring_revenue"
            value={slug}
            onChange={e => {
              setSlug(e.target.value)
              setSlugManual(true)
            }}
            className="font-mono text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="metric-desc">Description</Label>
        <Textarea
          id="metric-desc"
          placeholder="Describe this metric so Claude knows what to look for in emails…"
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          This is what Claude uses to identify the metric in emails. Be specific.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="metric-unit">Unit</Label>
          <Input
            id="metric-unit"
            placeholder={`${currencySymbol}, %, #, users, etc.`}
            value={unit}
            onChange={e => {
              const v = e.target.value
              setUnit(v)
              const trimmed = v.trim()
              if (CURRENCY_SYMBOLS.has(trimmed)) {
                setUnitPosition('prefix')
                setValueType('currency')
              } else if (trimmed === '%') {
                setUnitPosition('suffix')
                setValueType('percentage')
              } else if (trimmed === '#' || trimmed === '') {
                setUnitPosition('suffix')
                setValueType('number')
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            Use # or leave empty for plain numbers.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Unit position</Label>
          <div className="flex rounded-md border overflow-hidden">
            <button
              type="button"
              onClick={() => setUnitPosition('prefix')}
              className={cn(
                'flex-1 text-sm py-2 transition-colors',
                unitPosition === 'prefix'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-muted-foreground'
              )}
            >
              Prefix ({currencySymbol}100)
            </button>
            <button
              type="button"
              onClick={() => setUnitPosition('suffix')}
              className={cn(
                'flex-1 text-sm py-2 transition-colors border-l',
                unitPosition === 'suffix'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-muted-foreground'
              )}
            >
              Suffix (100%)
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Value type</Label>
          <Select value={valueType} onValueChange={(v) => setValueType(v as typeof valueType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="number">Number</SelectItem>
              <SelectItem value="currency">Currency</SelectItem>
              <SelectItem value="percentage">Percentage</SelectItem>
              <SelectItem value="text">Text</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {valueType === 'currency' && (
          <div className="space-y-2">
            <Label>Currency</Label>
            <Select value={currency || fundCurrency} onValueChange={setCurrency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(c => (
                  <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Leave as fund default ({fundCurrency}) or override per metric.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="display-order">Display order</Label>
        <Input
          id="display-order"
          type="number"
          value={displayOrder}
          onChange={e => setDisplayOrder(e.target.value)}
          className="w-24"
        />
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add metric'}
        </Button>
      </div>
    </div>
  )
}
