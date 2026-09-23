'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'

/**
 * How client components reach the outside world: `fetch` for the app's own API and `navigate`
 * for moving between pages.
 *
 * In the app both are the platform's own (window.fetch, the Next router), and nothing here is
 * visible. The seam exists for the one place the same components render OUTSIDE the app: the
 * public demo widget (demo-widget/), which mounts the command palette and the Analyst on the
 * marketing site with a `fetch` that answers from a data snapshot and stored Analyst replies,
 * and a `navigate` that switches the widget's own screens. The components keep calling the same
 * URLs; only the thing that answers them changes, which is what keeps the demo the real product
 * rather than a copy of it.
 *
 * `navigate` defaults to a full-page load so a component rendered without a provider still
 * works; AppShell supplies the router so in-app jumps stay client-side.
 */
export type AppFetch = (input: string, init?: RequestInit) => Promise<Response>
export type AppNavigate = (href: string) => void

interface AppRuntime {
  fetch: AppFetch
  navigate: AppNavigate
}

const defaultRuntime: AppRuntime = {
  fetch: (input, init) => globalThis.fetch(input, init),
  navigate: href => { window.location.assign(href) },
}

const AppRuntimeContext = createContext<AppRuntime>(defaultRuntime)

export function AppRuntimeProvider({
  fetch,
  navigate,
  children,
}: {
  fetch?: AppFetch
  navigate?: AppNavigate
  children: ReactNode
}) {
  const value = useMemo<AppRuntime>(() => ({
    fetch: fetch ?? defaultRuntime.fetch,
    navigate: navigate ?? defaultRuntime.navigate,
  }), [fetch, navigate])
  return <AppRuntimeContext.Provider value={value}>{children}</AppRuntimeContext.Provider>
}

/** The app's `fetch`. Same signature as the platform's for the string-URL calls the app makes. */
export function useAppFetch(): AppFetch {
  return useContext(AppRuntimeContext).fetch
}

/** Client-side navigation, or a full load where no router is provided. */
export function useAppNavigate(): AppNavigate {
  return useContext(AppRuntimeContext).navigate
}
