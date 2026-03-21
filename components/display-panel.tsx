'use client'

import { X, SlidersHorizontal } from 'lucide-react'
import { useDisplayPanel } from '@/components/display-panel-context'
import { useDisplayUnit } from '@/components/display-unit-context'
import { useTheme } from 'next-themes'
import { MobileDrawerPanel } from '@/components/mobile-drawer-panel'

export function DisplayPanelButton() {
  const { toggle } = useDisplayPanel()
  return (
    <button
      onClick={toggle}
      className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground transition-colors"
    >
      <SlidersHorizontal className="h-4 w-4" />
      Display
    </button>
  )
}

export function DisplayPanel() {
  const { open, close } = useDisplayPanel()
  const { displayUnit, setDisplayUnit } = useDisplayUnit()
  const { theme, setTheme } = useTheme()

  const units = [
    { value: 'full', label: 'Full' },
    { value: 'millions', label: 'Millions (M)' },
    { value: 'thousands', label: 'Thousands (K)' },
  ] as const

  const themes = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ] as const

  return (
    <MobileDrawerPanel open={open} onOpenChange={(isOpen) => { if (!isOpen) close() }}>
      <div className="flex flex-col h-full">
        <div className="max-h-[80vh] lg:max-h-[calc(100vh-6rem)] rounded-lg border bg-card flex flex-col flex-1">
          {/* Header */}
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Display
            </h2>
            <button onClick={close} className="p-1 rounded hover:bg-muted hidden lg:block">
              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          </div>

          {/* Content */}
          <div className="px-4 pb-4 space-y-6">
            {/* Number format */}
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

            {/* Theme */}
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
      </div>
    </MobileDrawerPanel>
  )
}
