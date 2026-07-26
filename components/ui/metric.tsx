import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A labelled figure — the KPI tile used across fund overview, fund detail, the LP
 * list, the LP portal and the diligence summaries.
 *
 * It exists because six near-identical copies had drifted: some values were
 * text-xl and some text-2xl, some carried tabular-nums and some didn't, and the
 * label sat above in four and below in two. A figure is the thing a reader
 * actually came for, so it gets the promotion the rest of the dense UI doesn't:
 * the value is the largest type on most of these pages, and the label recedes to
 * an eyebrow above it.
 *
 * `value` is always rendered with tabular figures — these are numbers, and
 * columns of tiles should align down the page.
 */
export interface MetricProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string
  value: React.ReactNode
  /** Fine print under the figure — "as of" dates, denominators, hints. */
  sub?: React.ReactNode
  /** Drop the card chrome, for tiles already inside a bordered surface. */
  bare?: boolean
}

const Metric = React.forwardRef<HTMLDivElement, MetricProps>(
  ({ label, value, sub, bare = false, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(bare ? '' : 'rounded-card border bg-card p-4', className)}
      {...props}
    >
      <p className="text-eyebrow uppercase text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-caption text-muted-foreground">{sub}</p>}
    </div>
  )
)
Metric.displayName = 'Metric'

export { Metric }
