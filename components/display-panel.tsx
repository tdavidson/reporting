'use client'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, SlidersHorizontal } from 'lucide-react'
import { useDisplayPanel } from '@/components/display-panel-context'
import { useDisplayUnit } from '@/components/display-unit-context'
import { useTheme } from 'next-themes'
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

export function DisplayPanel() {
  const { open, close } = useDisplayPanel()
  const { displayUnit, setDisplayUnit } = useDisplayUnit()
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, close])

  if (!open) return null

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

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
        onClick={close}
      />
      {/* Modal */}
      <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] rounded-lg border bg-card shadow-xl">
        <div className="px-4 py-3 flex items-center justify-between border-b">
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Display
          </h2>
          <button onClick={close} className="p-1 rounded hover:bg-muted">
            <X className="h-3.5 w-3.5 text-muted-foreground" />
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
    </>,
    document.body
  )
}
