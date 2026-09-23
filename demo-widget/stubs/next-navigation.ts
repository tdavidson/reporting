import { useSyncExternalStore } from 'react'
import { useAppNavigate } from '@/components/app-runtime'

/**
 * `next/navigation` for the widget bundle. There is no router: the widget keeps the current
 * location in a tiny store that DemoApp writes on every navigation, and `useRouter().push` is
 * the runtime's `navigate`. Route params come from the route table's match, so `useParams()`
 * answers the way it does under app/(app)/letters/[id].
 */
interface DemoLocation { pathname: string; search: string; params: Record<string, string> }

let location: DemoLocation = { pathname: '/dashboard', search: '', params: {} }
const listeners = new Set<() => void>()

export function setDemoLocation(next: DemoLocation) {
  if (next.pathname === location.pathname && next.search === location.search) return
  location = next
  for (const l of listeners) l()
}

export function getDemoLocation(): DemoLocation {
  return location
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

const useLocation = () => useSyncExternalStore(subscribe, () => location, () => location)

export function usePathname(): string {
  return useLocation().pathname
}

export function useRouter() {
  const navigate = useAppNavigate()
  return {
    push: navigate,
    replace: navigate,
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => {},
  }
}

export function useSearchParams(): URLSearchParams {
  const { search } = useLocation()
  return new URLSearchParams(search)
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useLocation().params as T
}

export function useSelectedLayoutSegment(): string | null {
  const segments = useLocation().pathname.split('/').filter(Boolean)
  return segments[0] ?? null
}

export function redirect(href: string): never {
  throw new Error(`redirect(${href}) is not available in the demo widget`)
}

export function notFound(): never {
  throw new Error('notFound() is not available in the demo widget')
}
