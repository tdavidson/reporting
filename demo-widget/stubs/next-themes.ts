/**
 * `next-themes` for the widget bundle. The marketing site owns the theme (a `dark` class on
 * <html>); the widget only reads it, and nothing in the bundle renders a switch.
 */
export function useTheme() {
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const theme = dark ? 'dark' : 'light'
  return {
    theme,
    resolvedTheme: theme,
    systemTheme: theme,
    themes: ['light', 'dark'],
    setTheme: (_next: string) => {},
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return children
}
