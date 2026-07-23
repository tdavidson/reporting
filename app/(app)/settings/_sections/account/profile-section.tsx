'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check, Loader2 } from 'lucide-react'
import { Section } from '@/components/settings/section'

export function ProfileSection({ displayName, onSaved }: { displayName: string; onSaved: () => void }) {
  const [value, setValue] = useState(displayName)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: value }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  return (
    <Section title="Your profile">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
        <div className="flex-1">
          <Label>Display name</Label>
          <p className="text-xs text-muted-foreground mt-1 mb-1.5">
            Shown on notes and activity. If empty, your email will be used.
          </p>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Your name"
          />
        </div>
        <Button onClick={handleSave} disabled={saving || value === displayName} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}
