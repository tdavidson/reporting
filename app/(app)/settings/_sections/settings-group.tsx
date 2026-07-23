'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

/** Generic collapsible group for the settings page. Every top-level section on the page
 *  (Account, Agent access, Fund, Platform, and each ProductGroup) renders inside one of
 *  these, so the page reads as a flat list of collapsible groups rather than a long scroll. */
export function SettingsGroup({ label, description, defaultOpen = true, children }: {
  label: string
  description?: string
  defaultOpen?: boolean
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 p-4 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{label}</div>
          {description && <div className="text-xs text-muted-foreground">{description}</div>}
        </div>
      </button>
      {open && children != null && <div className="px-4 pb-4 space-y-6">{children}</div>}
    </div>
  )
}
