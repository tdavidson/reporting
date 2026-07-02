import Link from 'next/link'
import { ArrowLeft, type LucideIcon } from 'lucide-react'

/**
 * Shared shell for Accounting sub-pages while the section is under construction.
 * Renders a consistent header + an "in development" note; real content replaces
 * `children` as each page is built and reconciled.
 */
export function AccountingPlaceholder({
  title,
  icon: Icon,
  intro,
  children,
}: {
  title: string
  icon: LucideIcon
  intro: string
  children?: React.ReactNode
}) {
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <Link
        href="/accounting"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Accounting
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Icon className="h-6 w-6" />
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </div>
      <div className="border border-dashed rounded-lg p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {children ?? 'In development. This page will render once the ledger is populated.'}
        </p>
      </div>
    </div>
  )
}
