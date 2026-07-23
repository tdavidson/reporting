'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Check, Loader2 } from 'lucide-react'
import { Section } from '@/components/settings/section'

const SUPPORTED_CURRENCIES = [
  { code: 'USD', label: 'USD – US Dollar' },
  { code: 'EUR', label: 'EUR – Euro' },
  { code: 'GBP', label: 'GBP – British Pound' },
  { code: 'CHF', label: 'CHF – Swiss Franc' },
  { code: 'CAD', label: 'CAD – Canadian Dollar' },
  { code: 'AUD', label: 'AUD – Australian Dollar' },
  { code: 'JPY', label: 'JPY – Japanese Yen' },
  { code: 'CNY', label: 'CNY – Chinese Yuan' },
  { code: 'INR', label: 'INR – Indian Rupee' },
  { code: 'SGD', label: 'SGD – Singapore Dollar' },
  { code: 'HKD', label: 'HKD – Hong Kong Dollar' },
  { code: 'SEK', label: 'SEK – Swedish Krona' },
  { code: 'NOK', label: 'NOK – Norwegian Krone' },
  { code: 'DKK', label: 'DKK – Danish Krone' },
  { code: 'NZD', label: 'NZD – New Zealand Dollar' },
  { code: 'BRL', label: 'BRL – Brazilian Real' },
  { code: 'ZAR', label: 'ZAR – South African Rand' },
  { code: 'ILS', label: 'ILS – Israeli Shekel' },
  { code: 'KRW', label: 'KRW – South Korean Won' },
]

export function CurrencySection({ currency, onSaved }: { currency: string; onSaved: () => void }) {
  const [value, setValue] = useState(currency)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: value }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  return (
    <Section title="Fund currency">
      <p className="text-xs text-muted-foreground mb-3">
        The default currency used for investment values and currency-type metrics across the app.
      </p>
      <div className="flex items-end gap-3">
        <div className="flex-1 max-w-xs">
          <Label>Currency</Label>
          <select
            value={value}
            onChange={e => setValue(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {SUPPORTED_CURRENCIES.map(c => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>
        <Button onClick={handleSave} disabled={saving || value === currency} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}
