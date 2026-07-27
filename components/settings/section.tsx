'use client'

// The Settings page's section chrome, and the context that marks a region of it as
// admin-only (amber border + a lock icon).
//
// These used to be private to app/(app)/settings/page.tsx, which meant a settings card
// living in its own file under components/settings/ could not pick the chrome up — it
// had to render a plain <Card>, and so read as an ordinary member-editable setting even
// when it sat inside the admin block and its API returned 403 to everyone else. Anything
// that renders on the settings page should use <Section> from here, so "who can change
// this?" is answered the same way everywhere.

import { createContext, useContext } from 'react'
import { Lock } from 'lucide-react'

/** True inside a region of the settings page that only an admin can see or change.
 *  Set by page.tsx around its admin blocks; every component below reads it. */
export const AdminSectionContext = createContext(false)

export function GroupHeader({ label }: { label: string }) {
  const isAdminSection = useContext(AdminSectionContext)
  const lineColor = isAdminSection ? 'bg-warning/30' : 'bg-border'
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className={`h-px flex-1 ${lineColor}`} />
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        {isAdminSection && <Lock className="h-2.5 w-2.5 text-warning" />}
        {label}
      </span>
      <div className={`h-px flex-1 ${lineColor}`} />
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const isAdminSection = useContext(AdminSectionContext)
  return (
    <div className={`rounded-card border bg-card p-5 ${isAdminSection ? 'border-warning/30' : ''}`}>
      <h2 className="text-base font-medium mb-3 flex items-center gap-1.5">
        {isAdminSection && <Lock className="h-3 w-3 text-warning" />}
        {title}
      </h2>
      {children}
    </div>
  )
}
