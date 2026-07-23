'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Section, GroupHeader } from '@/components/settings/section'
import { SettingsCard, SettingsCardGrid } from '@/components/settings-card'
import { FEATURE_META } from '@/lib/types/feature-meta'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'
import type { FeatureKey, FeatureVisibility, FeatureVisibilityMap } from '@/lib/types/features'
import { groupFeaturesByProduct, PRODUCT_META } from '@/lib/access/products'
import { LpPortalCard } from '../products/lp/lp-portal-card'

// These four set the fund-level CEILING, not the answer: a member also needs the matching per-user
// grant (Team, below). "Members" therefore means "each member reaches it subject to their grant" —
// hence labels that name the grant rather than promising blanket visibility.
//
// "Hidden" used to read "Removed from sidebar, still accessible via URL". That was accurate and it
// was the bug: hiding a page while its API still served the data is not access control. Hidden now
// denies every surface.
const VISIBILITY_OPTIONS: { value: FeatureVisibility; label: string; description: string }[] = [
  { value: 'everyone', label: 'Members', description: 'On — each member gets what you grant them below' },
  { value: 'admin', label: 'Admins only', description: 'On — no member can be granted it' },
  { value: 'off', label: 'Off', description: 'Nobody, admins included. Data is kept.' },
]

/** Stored `hidden` is the same as `off` now — show it as Off rather than a fourth button. */
const displayLevel = (level: FeatureVisibility): FeatureVisibility => (level === 'hidden' ? 'off' : level)

export function FeatureVisibilitySection({
  featureVisibility,
  lpPortalEnabled,
  onSaved,
}: {
  featureVisibility: Record<string, string>
  lpPortalEnabled: boolean
  onSaved: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(featureVisibility)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleChange = async (key: FeatureKey, level: FeatureVisibility) => {
    const next = { ...values, [key]: level }
    setValues(next)
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featureVisibility: next }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  return (
    <Section title="Feature visibility">
      <p className="text-xs text-muted-foreground mb-4">
        Whether each area is on for the fund, and the most anyone may have. This is only half the
        answer for a member — set what each person gets under Team → Access below. Off denies
        everyone, admins included.
      </p>

      {/* The one switch here that isn't about your team. It decides whether your INVESTORS have a
          portal at all — and the two LP cards below only mean anything while it's on, which is why
          it sits with them rather than in a section of its own further down the page. */}
      <div className="mb-3">
        <LpPortalCard enabled={lpPortalEnabled} onSaved={onSaved} />
      </div>

      {groupFeaturesByProduct().map(({ product, features }) => (
        <div key={product}>
          <GroupHeader label={PRODUCT_META[product].label} />
          <SettingsCardGrid>
            {features.map(key => {
              const current = displayLevel((values[key] ?? DEFAULT_FEATURE_VISIBILITY[key]) as FeatureVisibility)
              const meta = FEATURE_META[key]
              return (
                <SettingsCard
                  key={key}
                  title={meta.label}
                  subtitle={
                    <>
                      {meta.description}{' '}
                      <Link href={meta.href} className="underline underline-offset-2 hover:text-foreground">Learn more</Link>
                    </>
                  }
                >
                  {/* One button per level rather than a select: there are only three, and which one is
                      active is the thing you scan a long list for. */}
                  <div className="flex flex-wrap gap-1.5">
                    {VISIBILITY_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => handleChange(key, opt.value)}
                        title={opt.description}
                        className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                          current === opt.value
                            ? 'border-foreground/30 bg-accent font-medium'
                            : 'hover:bg-accent/30'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </SettingsCard>
              )
            })}
          </SettingsCardGrid>
        </div>
      ))}
      {saving && <p className="text-xs text-muted-foreground mt-3">Saving...</p>}
      {saved && <p className="text-xs text-green-600 mt-3">Saved</p>}
    </Section>
  )
}
