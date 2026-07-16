'use client'

// The card used by the settings lists that outgrew rows.
//
// A row works while every item has the same controls. Investment vehicles don't: an associate
// carries two extra selects, so its row wrapped to a second line and left-aligned while its
// neighbours stayed on one and right-aligned — nothing lined up, and the fields squeezed until
// "Vintage", "GP of Bluefish SPV LP" and "invests as …" all truncated mid-word.
//
// A card gives each item its own space and lets fields carry LABELS, which is what actually fixes
// the truncation: the label says "GP of", so the control only has to say "Bluefish SPV LP".

import type { ReactNode } from 'react'

export function SettingsCard({
  title,
  subtitle,
  aside,
  muted,
  children,
}: {
  title: ReactNode
  /** A line under the title — an alias, a description, a "learn more" link. */
  subtitle?: ReactNode
  /** Actions, pinned top-right so they sit in the same place on every card. */
  aside?: ReactNode
  /** Dimmed: still listed, no longer in use (a deactivated vehicle). */
  muted?: boolean
  children?: ReactNode
}) {
  return (
    <div className={`rounded-md border bg-card p-3 ${muted ? 'opacity-60' : ''}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </div>
      {children}
    </div>
  )
}

/** A labelled control. The label is the point — it takes the words out of the control. */
export function SettingsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

/** The responsive grid both lists sit in. `items-start` so a taller card doesn't stretch its row. */
export function SettingsCardGrid({ children }: { children: ReactNode }) {
  return <div className="grid items-start gap-3 md:grid-cols-2">{children}</div>
}
