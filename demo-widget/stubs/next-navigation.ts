import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import { useAppNavigate } from '@/components/app-runtime'

/**
 * `next/navigation` for the widget bundle. There is no router: DemoApp keeps the current
 * location in state and provides it here through context, and `useRouter().push` is the
 * runtime's `navigate`.
 *
 * Context, not a store outside React, and that is the point: in Next a page never sees the URL
 * of the page replacing it, because the new route tree replaces it in the same commit. A store
 * updated before the render told the outgoing page first, and a page that writes its state into
 * the URL (the general ledger does) answered by navigating straight back to itself.
 */
export interface DemoLocation { pathname: string; search: string; params: Record<string, string> }

const DemoLocationContext = createContext<DemoLocation>({ pathname: '/dashboard', search: '', params: {} })

export function DemoLocationProvider({ value, children }: { value: DemoLocation; children: ReactNode }) {
  return createElement(DemoLocationContext.Provider, { value }, children)
}

export function usePathname(): string {
  return useContext(DemoLocationContext).pathname
}

export function useRouter() {
  const navigate = useAppNavigate()
  return useMemo(() => ({
    push: (href: string) => navigate(href),
    // `replace` swaps the current history entry instead of adding one, as Next's does.
    replace: (href: string) => navigate(href, { replace: true }),
    back: () => { history.back() },
    forward: () => { history.forward() },
    refresh: () => {},
    prefetch: () => {},
  }), [navigate])
}

export function useSearchParams(): URLSearchParams {
  const { search } = useContext(DemoLocationContext)
  // One object per distinct query, so an effect that depends on it runs when the query changes
  // and not on every render.
  return useMemo(() => new URLSearchParams(search), [search])
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useContext(DemoLocationContext).params as T
}

export function useSelectedLayoutSegment(): string | null {
  const segments = useContext(DemoLocationContext).pathname.split('/').filter(Boolean)
  return segments[0] ?? null
}

export function redirect(href: string): never {
  throw new Error(`redirect(${href}) is not available in the demo widget`)
}

export function notFound(): never {
  throw new Error('notFound() is not available in the demo widget')
}
