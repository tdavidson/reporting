import { useSyncExternalStore } from 'react'

/**
 * `next-themes` for the widget bundle: the same System / Light / Dark setting the app keeps,
 * applied the same way (a `light` or `dark` class and `color-scheme` on <html>) and saved under
 * the host's storage key (mount's `themeStorageKey`), so the marketing site's own next-themes
 * reads the visitor's choice on the next page load. `system` follows prefers-color-scheme live.
 */
type Theme = 'system' | 'light' | 'dark'

let storageKey = 'theme'
let theme: Theme = 'system'
const listeners = new Set<() => void>()
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

const resolve = (t: Theme): 'light' | 'dark' => (t === 'system' ? (media?.matches ? 'dark' : 'light') : t)

function apply() {
  const resolved = resolve(theme)
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.style.colorScheme = resolved
  for (const l of listeners) l()
}

/** Called once by mount(): adopt the host's saved setting and follow the OS while on `system`. */
export function initDemoTheme(key: string | undefined) {
  if (key) storageKey = key
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'light' || saved === 'dark' || saved === 'system') theme = saved
  } catch { /* storage unavailable: start on system */ }
  media?.addEventListener('change', () => { if (theme === 'system') apply() })
  apply()
}

function setTheme(next: string) {
  if (next !== 'light' && next !== 'dark' && next !== 'system') return
  theme = next
  try { localStorage.setItem(storageKey, next) } catch { /* not persisted */ }
  apply()
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => `${theme}:${resolve(theme)}`

export function useTheme() {
  useSyncExternalStore(subscribe, snapshot, () => 'system:light')
  const resolved = resolve(theme)
  return {
    theme,
    resolvedTheme: resolved,
    systemTheme: (media?.matches ? 'dark' : 'light') as 'light' | 'dark',
    themes: ['light', 'dark', 'system'],
    setTheme,
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return children
}
