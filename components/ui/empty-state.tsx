import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A whole view with nothing in it — no journal entries, no letters, no companies.
 *
 * Distinct from an inline "nothing here yet" note inside an existing card, which
 * stays as plain `text-sm text-muted-foreground`. This is the panel version: it
 * owns the space where content would be, so it carries chrome and, where one
 * exists, the control that resolves the emptiness.
 *
 * `action` is the point. Most of these panels used to *describe* the way out in
 * prose — "add a partner above, or import opening balances from the Accounting
 * home page" — which is a link written as a sentence. If a user can act, give
 * them the control; keep the sentence for the cases where they genuinely can't
 * (wrong filter, no permission, waiting on someone else).
 */
export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** One sentence: what isn't here, and — when there's no action — why. */
  children: React.ReactNode
  icon?: LucideIcon
  /** Button(s)/link(s) that resolve it. Omit when there is nothing to offer. */
  action?: React.ReactNode
  /** Tighter padding, for a panel nested inside an existing card. */
  compact?: boolean
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ children, icon: Icon, action, compact = false, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-card border border-dashed text-center',
        compact ? 'p-6' : 'p-8 md:p-12',
        className
      )}
      {...props}
    >
      {Icon && <Icon className="h-8 w-8 mx-auto text-muted-foreground mb-3" aria-hidden />}
      <p className="text-sm text-muted-foreground max-w-readable mx-auto text-balance">{children}</p>
      {action && <div className="mt-4 flex items-center justify-center gap-2">{action}</div>}
    </div>
  )
)
EmptyState.displayName = 'EmptyState'

export { EmptyState }
