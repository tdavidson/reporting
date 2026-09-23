import { useSyncExternalStore } from 'react'
import { useAppNavigate } from '@/components/app-runtime'

/**
 * `next/navigation` for the widget bundle. There is no router: the widget keeps the "current
 * path" in a tiny store that DemoApp writes on every screen change, and `useRouter().push`
 * is the runtime's `navigate`.
 */
let pathname = '/dashboard'
const listeners = new Set<() => void>()

export function setDemoPathname(next: string) {
  if (next === pathname) return
  pathname = next
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => pathname, () => pathname)
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

const EMPTY = new URLSearchParams()
export function useSearchParams(): URLSearchParams {
  return EMPTY
}

export function useParams(): Record<string, string> {
  return {}
}

export function redirect(href: string): never {
  throw new Error(`redirect(${href}) is not available in the demo widget`)
}

export function notFound(): never {
  throw new Error('notFound() is not available in the demo widget')
}
