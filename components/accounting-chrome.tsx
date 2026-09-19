'use client'

import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'

/**
 * The header of every accounting page: title, an optional description, and an action group
 * that always ends with the Analyst toggle (the fund pages put the fund switcher before it).
 *
 * Two layouts, one markup, by grid placement:
 *  - From `sm` up, the /dashboard shape the rest of the app uses: title and description
 *    stacked on the left, the action group on the right and lowered (items-end) to sit
 *    beside the description.
 *  - On a phone the Analyst toggle alone sits beside the TITLE, as the Portfolio and
 *    Compliance headers keep their compact buttons, the description takes its own full-width
 *    line, and the page's own actions (the fund switcher, a lens toggle) take a row of their
 *    own under it. A 16rem select is not a compact button: kept beside the title it left
 *    "Capital accounts" 85px of a 343px screen and wrapped it one word per line.
 * The group is `display: contents` on a phone so the grid places its members one by one,
 * and a flex row from `sm` up; the two wrappers do the reverse. The title column is
 * minmax(0, 1fr) so a long name wraps or truncates inside it rather than pushing the row.
 *
 * `title` may carry a node (a badge beside the name); `titleAttr` is the plain string for the
 * tooltip and for `truncate` on a fund name that would otherwise wrap.
 *
 * Must be rendered ABOVE <AccountingBody>, never inside it: the body shares its row with
 * the Analyst panel, so a header inside it would be squeezed left when the panel opens.
 */
export function AccountingPageHeader({ title, titleAttr, truncateTitle = false, actions, children }: {
  title: React.ReactNode
  titleAttr?: string
  truncateTitle?: boolean
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-1">
      <h1 className={`min-w-0 text-2xl font-semibold tracking-tight ${truncateTitle ? 'truncate' : ''}`} title={titleAttr}>{title}</h1>
      <div className="contents sm:col-start-2 sm:row-start-1 sm:row-span-2 sm:flex sm:items-center sm:justify-end sm:gap-2 sm:self-end">
        {actions && <div className="col-span-2 row-start-3 mt-2 flex flex-wrap items-center gap-2 sm:contents">{actions}</div>}
        <div className="col-start-2 row-start-1 self-center sm:contents"><AnalystToggleButton /></div>
      </div>
      {children && <p className="col-span-2 min-w-0 text-sm text-muted-foreground sm:col-span-1">{children}</p>}
    </div>
  )
}

/** Content beside the Analyst panel — the panel shifts the page rather than covering it. */
export function AccountingBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <div className="flex-1 min-w-0 w-full">{children}</div>
      <AnalystPanel />
    </div>
  )
}
