'use client'

import { createContext, useContext, useState } from 'react'

const DisplayPanelContext = createContext<{
  open: boolean
  toggle: () => void
  close: () => void
}>({
  open: false,
  toggle: () => {},
  close: () => {},
})

export function DisplayPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <DisplayPanelContext.Provider value={{
      open,
      toggle: () => setOpen(v => !v),
      close: () => setOpen(false),
    }}>
      {children}
    </DisplayPanelContext.Provider>
  )
}

export function useDisplayPanel() {
  return useContext(DisplayPanelContext)
}
