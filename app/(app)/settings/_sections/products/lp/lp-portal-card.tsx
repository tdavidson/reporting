'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Loader2 } from 'lucide-react'
import { SettingsCard } from '@/components/settings-card'

// ──────────────────────────── LP Portal ────────────────────────────

/**
 * The LP portal's master switch, shown at the top of Feature visibility.
 *
 * It is NOT a visibility level, and deliberately doesn't look like one: everything else in that
 * section decides what your TEAM sees, while this decides whether your INVESTORS have a portal at
 * all. It used to sit in a section of its own much further down the page, which made it easy to
 * configure "LP documents & sharing" for the team and wonder why nothing reached anyone.
 *
 * When off, the layout forces the LP cards to hidden and their pages redirect — so those cards
 * mean nothing until this is on.
 */
export function LpPortalCard({ enabled, onSaved }: { enabled: boolean; onSaved: () => void }) {
  const [on, setOn] = useState(enabled)
  const [saving, setSaving] = useState(false)

  const handleToggle = async (checked: boolean) => {
    setOn(checked)
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lpPortalEnabled: checked }),
    })
    setSaving(false)
    if (res.ok) onSaved()
  }

  return (
    <SettingsCard
      title="LP portal"
      subtitle="For your investors, not your team: whether LPs can sign in and see what you’ve shared. While it’s off, “LP documents & sharing” and “LP activity log” are unavailable — to your team and to you. Everything else LP-related (letters, LP capital, GP entities) works either way."
      aside={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}
    >
      <div className="flex items-center gap-3">
        <Switch checked={on} onCheckedChange={handleToggle} disabled={saving} />
        <Label className="text-sm font-normal">{on ? 'On — LPs can sign in' : 'Off — nothing reaches LPs'}</Label>
      </div>
    </SettingsCard>
  )
}
