'use client'
import { X, SlidersHorizontal } from 'lucide-react'
import { useDisplayPanel } from '@/components/display-panel-context'
import { useDisplayUnit } from '@/components/display-unit-context'
import { useTheme } from 'next-themes'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

export function DisplayPanelButton() {
  const { toggle, open } = useDisplayPanel()
  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-8 w-8 text-muted-foreground hover:text-foreground ${open ? 'bg-accent' : ''}`}
      onClick={toggle}
      aria-label="Toggle display settings"
    >
      <SlidersHorizontal className="h-4 w-4" />
    </Button>
  )
}

function DisplayPanelContent({ close }: { close: () => void }) {
  const { displayUnit, setDisplayUnit } = useDisplayUnit()
  const { theme, setTheme } = useTheme()

  const units = [
    { value: 'full', label: 'Full' },
    { value: 'thousands', label: 'Thousands (K)' },
    { value: 'millions', label: 'Millions (M)' },
  ] as const

  const themes = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ] as const

  return (
    <div className="rounded-lg border bg-card shadow-lg w-[240px]">
      <div className="px-4 py-3 flex items-center justify-between border-b">
        <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Display
        </h2>
        <button onClick={close} className="p-1 rounded hover:bg-muted">
          <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>
      <div className="px-4 py-4 space-y-6">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Number Format</p>
          <div className="space-y-1">
            {units.map(unit => (
              <button
                key={unit.value}
                onClick={() => setDisplayUnit(unit.value)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  displayUnit === unit.value
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50'
                }`}
              >
                {unit.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Theme</p>
          <div className="space-y-1">
            {themes.map(t => (
              <button
                key={t.value}
                onClick={() => setTheme(t.value)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  theme === t.value
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function DisplayPanel() {
  const { open, close } = useDisplayPanel()
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  if (!open) return null

  if (isDesktop) {
    return <DisplayPanelContent close={close} />
  }

  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) close() }}>
      <SheetContent side="right" className="p-0 pt-12 w-[280px] max-w-[85vw]">
        <DisplayPanelContent close={close} />
      </SheetContent>
    </Sheet>
  )
}
