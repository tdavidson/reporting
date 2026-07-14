'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { FeatureVisibilityMap } from '@/lib/types/features'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'

const FeatureVisibilityContext = createContext<FeatureVisibilityMap>(DEFAULT_FEATURE_VISIBILITY)
const AdminContext = createContext<boolean>(false)
// Defaults to FALSE, deliberately. If the flag ever fails to reach a component, the
// failure mode is "the publish button is missing", not "the GP is offered a button that
// sends LP statements to a portal nobody can open".
const LpPortalContext = createContext<boolean>(false)

export function FeatureVisibilityProvider({
  value,
  isAdmin = false,
  lpPortalEnabled = false,
  children,
}: {
  value: FeatureVisibilityMap
  isAdmin?: boolean
  lpPortalEnabled?: boolean
  children: ReactNode
}) {
  return (
    <FeatureVisibilityContext.Provider value={value}>
      <AdminContext.Provider value={isAdmin}>
        <LpPortalContext.Provider value={lpPortalEnabled}>
          {children}
        </LpPortalContext.Provider>
      </AdminContext.Provider>
    </FeatureVisibilityContext.Provider>
  )
}

export function useFeatureVisibility() {
  return useContext(FeatureVisibilityContext)
}

/** Whether the current user is a fund admin (mirrors the server-resolved role). */
export function useIsAdmin() {
  return useContext(AdminContext)
}

/**
 * Whether the LP portal is switched on for this fund.
 *
 * Gate every "publish to the LP portal" / "share with LPs" affordance on this. The portal
 * being off already hides its nav and 404s its routes, but the buttons that PUSH content
 * into it lived on other pages (capital accounts, LP snapshots) and stayed visible — so a
 * GP could publish statements to a portal no LP can reach, and believe they'd sent them.
 */
export function useLpPortalEnabled() {
  return useContext(LpPortalContext)
}
