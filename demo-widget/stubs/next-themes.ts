import { useSyncExternalStore } from 'react'

/**
 * `next-themes` for the widget bundle. The marketing site owns the theme (a `dark` class on
 * <html>, kept by its own next-themes); the widget reads that class and, when the app's own
 * theme control is used, toggles it — the host's provider is not consulted, so the site's
 * remembered choice is untouched and the page follows it again on reload.
 */
const listeners = new Set<() => void>()
let observer: MutationObserver | null = null

function current(): 'light' | 'dark' {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function subscribe(l: () => void) {
  listeners.add(l)
  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => { for (const fn of listeners) fn() })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  }
  return () => { listeners.delete(l) }
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => 'light' as const)
  return {
    theme,
    resolvedTheme: theme,
    systemTheme: theme,
    themes: ['light', 'dark'],
    setTheme: (next: string) => {
      const dark = next === 'dark' || (next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', dark)
    },
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return children
}
