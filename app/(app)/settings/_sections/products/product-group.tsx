'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { PRODUCT_META, type ProductKey } from '@/lib/access/products'

/**
 * Collapsible wrapper for one product's settings. Expanded by default when the product is active
 * (any of its features on); collapsed when off, so a fresh fund shows only Portfolio Reporting.
 * (A one-click enable/disable control is added in a later task.)
 */
export function ProductGroup({ product, active, children }: { product: ProductKey; active: boolean; children?: React.ReactNode }) {
  const meta = PRODUCT_META[product]
  const [open, setOpen] = useState(active)
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-4 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{meta.label}</div>
          <div className="text-xs text-muted-foreground">{meta.description}</div>
        </div>
        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${active ? 'text-green-600 border-green-600/30' : 'text-muted-foreground border-border'}`}>
          {active ? 'On' : 'Off'}
        </span>
      </button>
      {open && children != null && <div className="px-4 pb-4 space-y-6">{children}</div>}
    </div>
  )
}
