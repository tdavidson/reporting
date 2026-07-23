'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check, Loader2 } from 'lucide-react'
import { Section } from '@/components/settings/section'

export function AnalyticsSection({
  fathomSiteId,
  gaMeasurementId,
  onSaved,
}: {
  fathomSiteId: string | null
  gaMeasurementId: string | null
  onSaved: () => void
}) {
  const [fathom, setFathom] = useState(fathomSiteId ?? '')
  const [ga, setGa] = useState(gaMeasurementId ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const hasChanges =
    fathom !== (fathomSiteId ?? '') ||
    ga !== (gaMeasurementId ?? '')

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analyticsFathomSiteId: fathom,
        analyticsGaMeasurementId: ga,
      }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  return (
    <Section title="Analytics tracking">
      <p className="text-xs text-muted-foreground mb-4">
        Add analytics scripts to your app. These are rendered on authenticated pages only.
      </p>
      <div className="space-y-4">
        <div>
          <Label>Fathom Site ID</Label>
          <Input
            value={fathom}
            onChange={(e) => setFathom(e.target.value)}
            placeholder="ABCDEFGH"
            className="max-w-xs font-mono mt-1"
          />
        </div>
        <div>
          <Label>Google Analytics Measurement ID</Label>
          <Input
            value={ga}
            onChange={(e) => setGa(e.target.value)}
            placeholder="G-XXXXXXXXXX"
            className="max-w-xs font-mono mt-1"
          />
        </div>
        <Button onClick={handleSave} disabled={saving || !hasChanges} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}
