'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { FEATURE_META } from '@/lib/types/feature-meta'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'
import type { FeatureKey, FeatureVisibility } from '@/lib/types/features'

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

/**
 * The per-feature everyone/admin/off cards, for a GIVEN list of features. Used inside each
 * ProductGroup's "Access" panel — one product's worth at a time — rather than as a single
 * standalone grid grouped by product.
 */
export function FeatureAccessControls({ features, values, onChange, rowsBefore }: {
  features: FeatureKey[]
  values: Record<string, string>
  onChange: (key: FeatureKey, level: FeatureVisibility) => void
  /** Optional custom row rendered (as a sibling, so it picks up the same divider) just ABOVE a given feature's row. */
  rowsBefore?: Partial<Record<FeatureKey, React.ReactNode>>
}) {
  // Rows, not cards: the everyone/admin/off buttons line up in a fixed column on the right so
  // access is scannable straight down the list.
  return (
    <div className="rounded-lg border divide-y">
      {features.map(key => {
        const current = displayLevel((values[key] ?? DEFAULT_FEATURE_VISIBILITY[key]) as FeatureVisibility)
        const meta = FEATURE_META[key]
        return (
          <Fragment key={key}>
            {rowsBefore?.[key]}
          <div className="flex items-center justify-between gap-4 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">{meta.label}</div>
              <div className="text-xs text-muted-foreground">
                {meta.description}{' '}
                <Link href={meta.href} className="underline underline-offset-2 hover:text-foreground">Learn more</Link>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {VISIBILITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => onChange(key, opt.value)}
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
          </div>
          </Fragment>
        )
      })}
    </div>
  )
}
