/**
 * The `?action=` a link can hand the capital accounts page.
 *
 * The page folds calls and distributions into one panel with two directions, opened by two
 * buttons. /start offers each as a shortcut, and a shortcut that lands on the page with the
 * panel still closed is only half a shortcut — so the URL carries which one to open. Kept as a
 * pure module so the page, the entity picker that forwards it, and /start's links agree on the
 * vocabulary without importing each other.
 */
export type CapitalAction = 'call' | 'distribution'

export function capitalActionFromParam(value: string | null | undefined): CapitalAction | null {
  return value === 'call' || value === 'distribution' ? value : null
}

/** Append the action to a URL, or return it untouched when there is none to carry. */
export function withCapitalAction(href: string, action: CapitalAction | null): string {
  return action ? `${href}?action=${action}` : href
}
