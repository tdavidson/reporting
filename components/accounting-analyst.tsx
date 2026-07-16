'use client'

// The accounting Analyst — same header-button + page-shifting side panel the app's Analyst uses
// elsewhere (/dashboard, /import), so accounting is consistent with the rest of the app. Split into
// a Provider (open state), a Button (goes in the header, right-aligned), and a Panel (a flex
// sibling of the page content, so it aligns beside the content rather than floating at the top).
// The panel content is the accounting assistant — it reads the current vehicle's books and drafts
// entries you approve.

import { createContext, useContext, useState, type ReactNode } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AssistantPanel } from '@/app/(app)/funds/status/assistant-panel'

const Ctx = createContext<{ open: boolean; toggle: () => void; close: () => void }>({ open: false, toggle: () => {}, close: () => {} })

export function AccountingAnalystProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <Ctx.Provider value={{ open, toggle: () => setOpen(o => !o), close: () => setOpen(false) }}>{children}</Ctx.Provider>
}

/** The "Analyst" toggle — placed in the page header, right-aligned. */
export function AccountingAnalystButton() {
  const { open, toggle } = useContext(Ctx)
  return (
    <Button
      variant="outline"
      size="sm"
      className={`gap-1.5 h-8 py-2 text-muted-foreground hover:text-foreground ${open ? 'bg-accent' : ''}`}
      onClick={toggle}
    >
      <Sparkles className="h-3.5 w-3.5" />
      Analyst
    </Button>
  )
}

/** The side panel — a flex sibling of the page content, so it shifts the page and aligns with it. */
export function AccountingAnalystPanel() {
  const { open, close } = useContext(Ctx)
  if (!open) return null
  return (
    <aside className="w-full lg:w-[400px] shrink-0 px-4 md:pr-4 lg:pl-0 lg:sticky lg:top-4">
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-muted-foreground" />Analyst
          </span>
          <button onClick={close} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(100vh-9rem)] overflow-y-auto p-3">
          <AssistantPanel />
        </div>
      </div>
    </aside>
  )
}
