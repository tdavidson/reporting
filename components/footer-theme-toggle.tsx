'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Sun, Moon } from 'lucide-react'

// System / light / dark cycle, styled to sit in the footer alongside the legal links.
// Matches the hemrock.com footer toggle: icon + label, muted until hover.
const CYCLE = ['system', 'light', 'dark'] as const
const ICONS = { system: Monitor, light: Sun, dark: Moon }
const LABELS = { system: 'System', light: 'Light', dark: 'Dark' }

export function FooterThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const current = (mounted && CYCLE.includes(theme as (typeof CYCLE)[number]) ? theme : 'system') as (typeof CYCLE)[number]
  const Icon = ICONS[current]
  return (
    <button
      onClick={() => setTheme(CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length])}
      title={`Theme: ${LABELS[current]}, click to cycle`}
      aria-label={`Theme: ${LABELS[current]}`}
      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{LABELS[current]}</span>
    </button>
  )
}
