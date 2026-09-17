'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

/**
 * The one desktop nav preference: whether the contextual panel (the current section's sub-pages,
 * beside the icon rail) is shown or hidden.
 *
 * This used to be `collapsed`, for a sidebar that traded its labels for horizontal room. The rail
 * is always its 64px, so there is nothing left to collapse — what a wide table wants now is the
 * panel out of the way, and that is what this remembers. The old key is not migrated: a collapsed
 * sidebar and a hidden panel are different wishes, and the panel is the safer default.
 */
interface SidebarContextValue {
  panelHidden: boolean
  togglePanel: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

const STORAGE_KEY = 'nav-panel-hidden'

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [panelHidden, setPanelHidden] = useState(false)

  // Hydrate from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'true') setPanelHidden(true)
    } catch {
      // SSR or storage unavailable
    }
  }, [])

  const togglePanel = useCallback(() => {
    setPanelHidden((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEY, String(next)) } catch {}
      return next
    })
  }, [])

  return (
    <SidebarContext.Provider value={{ panelHidden, togglePanel }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider')
  return ctx
}
