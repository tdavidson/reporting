'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { PRODUCT_META, isProductActive, recommendedVisibilityForProduct, disabledVisibilityForProduct, type ProductKey } from '@/lib/access/products'
import { FeatureAccessControls } from '../access/feature-access-controls'
import { Section } from '@/components/settings/section'
import type { FeatureKey, FeatureVisibility, FeatureVisibilityMap } from '@/lib/types/features'

/**
 * Collapsible wrapper for one product's settings. Expanded by default when the product is active
 * (any of its features on); collapsed when off, so a fresh fund shows only Portfolio Reporting.
 * Includes a one-click Turn on/off control that bulk-updates feature visibility for every
 * feature the product owns via the existing partial-merge `/api/settings` PATCH.
 *
 * The expanded body always leads with the product's own "Access" panel — the everyone/admin/off
 * controls for exactly this product's features — followed by the product's other settings
 * (children). This is what replaced the standalone feature-visibility grid: each product now
 * carries its own access controls instead of them living in one big grid elsewhere on the page.
 */
export function ProductGroup({ product, values, onFeatureChange, onToggled, children }: {
  product: ProductKey
  values: Record<string, string>
  onFeatureChange: (key: FeatureKey, level: FeatureVisibility) => void
  onToggled: () => void
  children?: React.ReactNode
}) {
  const meta = PRODUCT_META[product]
  const active = isProductActive(product, values as FeatureVisibilityMap)
  const [open, setOpen] = useState(active)
  const [busy, setBusy] = useState(false)

  async function apply(map: Partial<FeatureVisibilityMap>, openAfter: boolean) {
    setBusy(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featureVisibility: { ...values, ...map } }),
    })
    setBusy(false)
    if (res.ok) {
      if (openAfter) setOpen(true)
      onToggled()
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{meta.label}</div>
            <div className="text-xs text-muted-foreground">{meta.description}</div>
          </div>
        </button>
        {active ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => apply(disabledVisibilityForProduct(product), false)}
            className="text-xs px-3 py-1.5 rounded-md border hover:bg-accent/30 disabled:opacity-50 shrink-0"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Turn off'}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => apply(recommendedVisibilityForProduct(product), true)}
            className="text-xs px-3 py-1.5 rounded-md border border-foreground/30 bg-accent font-medium hover:bg-accent/70 disabled:opacity-50 shrink-0"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Turn on ${meta.label}`}
          </button>
        )}
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-6">
          <Section title="Access">
            <FeatureAccessControls features={meta.features} values={values} onChange={onFeatureChange} />
          </Section>
          {children}
        </div>
      )}
    </div>
  )
}
