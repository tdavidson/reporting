'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export function CollapsibleJson({ label, data }: { label: string; data: unknown }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border">
      <button
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        {label}
      </button>
      {open && (
        <div className="border-t">
          <pre className="text-xs p-4 overflow-auto max-h-96 font-mono bg-muted/30">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
