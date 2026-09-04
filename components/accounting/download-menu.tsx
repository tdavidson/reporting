'use client'

import { useState } from 'react'
import { Download, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface DownloadItem {
  label: string
  /** What the file is, in a few words. */
  note?: string
  href: string
}

/**
 * A Download button that opens a list of files — the workbook, the PDF, the CSVs — each a plain
 * link to the route that builds it, so the browser handles the download and nothing needs
 * JavaScript once the menu is open. `children` renders under the list, for a control that needs
 * an input first (the tax package's year).
 */
export function DownloadMenu({
  items, disabled, label = 'Download', children,
}: {
  items: DownloadItem[]
  disabled?: boolean
  label?: string
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-9" disabled={disabled}>
          <Download className="h-4 w-4 mr-1.5" />{label}
          <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <div className="space-y-0.5">
          {items.map(it => (
            <a
              key={it.href}
              href={it.href}
              onClick={() => setOpen(false)}
              className="block rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <div>{it.label}</div>
              {it.note && <div className="text-xs text-muted-foreground">{it.note}</div>}
            </a>
          ))}
        </div>
        {children && <div className="mt-2 border-t pt-2">{children}</div>}
      </PopoverContent>
    </Popover>
  )
}

/** The year picker + link for the tax package, shared by the statements page and Admin. */
export function TaxPackageLink({ group, base = '/api/accounting/tax-package' }: { group: string | null; base?: string }) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear - 1)
  const qs = new URLSearchParams({ year: String(year) })
  if (group) qs.set('group', group)
  return (
    <div className="px-2 py-1.5 text-sm">
      <div className="mb-1">Tax package</div>
      <div className="text-xs text-muted-foreground mb-2">
        One ZIP for the preparer: workpapers with the prior year, statements PDF, general ledger, journal (plain and QuickBooks layout), chart of accounts, and the finalised K-1 workbook when there is one.
      </div>
      <div className="flex items-center gap-2">
        <select
          value={year}
          onChange={e => setYear(parseInt(e.target.value, 10))}
          aria-label="Tax year"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          {Array.from({ length: 8 }, (_, i) => thisYear - i).map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <a
          href={`${base}?${qs}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
        >
          <Download className="h-3.5 w-3.5" />Download {year} package
        </a>
      </div>
    </div>
  )
}
