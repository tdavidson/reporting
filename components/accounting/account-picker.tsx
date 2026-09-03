'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'

export interface PickerAccount {
  id: string
  code: string
  name: string
  type?: string | null
  lpEntityId?: string | null
}

/**
 * A type-ahead account picker: type a code or part of a name, pick from the matches.
 *
 * A plain <select> was fine for a fifteen-line chart. It is not fine once the chart carries one
 * capital account per partner, one cost and one unrealized account per company, and one
 * intercompany account per affiliate — and an accountant expects to type "1000" or "cash" and
 * press Enter, the way every other ledger lets them.
 *
 * Matching is by code prefix first (typing "31" lists the capital accounts), then by any
 * substring of the name. Keyboard: arrows move, Enter picks, Escape closes.
 */
export function AccountPicker({
  accounts, value, onChange, placeholder = 'Account code or name…', autoFocus, className = '',
}: {
  accounts: PickerAccount[]
  /** The selected account's id, or ''. */
  value: string
  onChange: (id: string) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}) {
  const selected = accounts.find(a => a.id === value) ?? null
  const label = (a: PickerAccount) => `${a.code} · ${a.name}`

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return accounts.slice(0, 12)
    const byCode = accounts.filter(a => a.code.toLowerCase().startsWith(q))
    const byName = accounts.filter(a => !byCode.includes(a) && (a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)))
    return [...byCode, ...byName].slice(0, 12)
  }, [accounts, query])

  // A new query starts the highlight back at the top of the new list.
  const changeQuery = (q: string) => { setQuery(q); setActive(0) }

  // Close on an outside click, without a portal or a library.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (a: PickerAccount) => { onChange(a.id); changeQuery(''); setOpen(false) }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="flex h-9 items-center rounded-md border border-input bg-background pr-1">
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls="account-picker-list"
          aria-autocomplete="list"
          autoFocus={autoFocus}
          value={open ? query : (selected ? label(selected) : '')}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); changeQuery('') }}
          onChange={e => { changeQuery(e.target.value); setOpen(true) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, matches.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); if (open && matches[active]) pick(matches[active]) }
            else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
          }}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show accounts"
          onClick={() => { setOpen(o => !o); inputRef.current?.focus() }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <ul
          id="account-picker-list"
          role="listbox"
          className="absolute left-0 z-30 mt-1 max-h-72 w-full min-w-[18rem] overflow-y-auto rounded-md border bg-card py-1 shadow-md"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No account matches &ldquo;{query}&rdquo;</li>
          ) : matches.map((a, i) => (
            <li
              key={a.id}
              role="option"
              aria-selected={a.id === value}
              onMouseDown={e => { e.preventDefault(); pick(a) }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm ${i === active ? 'bg-accent' : ''} ${a.id === value ? 'font-medium' : ''}`}
            >
              <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{a.code}</span>
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
