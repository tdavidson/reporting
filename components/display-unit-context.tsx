'use client'

import { createContext, useContext, useState } from 'react'

export type DisplayUnit = 'full' | 'millions' | 'thousands'

const DisplayUnitContext = createContext<{
  displayUnit: DisplayUnit
  setDisplayUnit: (unit: DisplayUnit) => void
}>({
  displayUnit: 'full',
  setDisplayUnit: () => {},
})

export function DisplayUnitProvider({ children }: { children: React.ReactNode }) {
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>('full')
  return (
    <DisplayUnitContext.Provider value={{ displayUnit, setDisplayUnit }}>
      {children}
    </DisplayUnitContext.Provider>
  )
}

export function useDisplayUnit() {
  return useContext(DisplayUnitContext)
}
