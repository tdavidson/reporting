'use client'

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { User, Building2, FolderOpen } from 'lucide-react'

export interface MentionMember {
  userId: string
  displayName: string
}

export interface TaggableItem {
  id: string
  displayName: string
  type: 'person' | 'company' | 'group'
}

interface MentionTextareaProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  members: MentionMember[]
  companies?: Array<{ id: string; name: string }>
  groups?: string[]
  placeholder?: string
  rows?: number
  className?: string
  autoFocus?: boolean
}

export interface MentionTextareaRef {
  focus: () => void
  element: HTMLTextAreaElement | null
}

function buildTaggables(
  members: MentionMember[],
  companies?: Array<{ id: string; name: string }>,
  groups?: string[]
): TaggableItem[] {
  const items: TaggableItem[] = []
  for (const m of members) {
    items.push({ id: m.userId, displayName: m.displayName, type: 'person' })
  }
  for (const c of companies ?? []) {
    items.push({ id: c.id, displayName: c.name, type: 'company' })
  }
  for (const g of groups ?? []) {
    items.push({ id: g, displayName: g, type: 'group' })
  }
  return items
}

const typeIcon = {
  person: User,
  company: Building2,
  group: FolderOpen,
}

export const MentionTextarea = forwardRef<MentionTextareaRef, MentionTextareaProps>(
  function MentionTextarea({ value, onChange, onKeyDown, members, companies, groups, placeholder, rows = 2, className, autoFocus }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const [showDropdown, setShowDropdown] = useState(false)
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [mentionStart, setMentionStart] = useState<number | null>(null)

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      element: textareaRef.current,
    }))

    const taggables = buildTaggables(members, companies, groups)

    const filtered = taggables.filter(t =>
      t.displayName.toLowerCase().includes(query.toLowerCase())
    )

    const insertMention = useCallback((item: TaggableItem) => {
      if (mentionStart === null) return
      const before = value.slice(0, mentionStart)
      const after = value.slice(textareaRef.current?.selectionStart ?? value.length)
      const newValue = `${before}@${item.displayName} ${after}`
      onChange(newValue)
      setShowDropdown(false)
      setMentionStart(null)
      setQuery('')
      // Focus and set cursor after the inserted mention
      setTimeout(() => {
        const cursor = before.length + item.displayName.length + 2 // +2 for @ and space
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(cursor, cursor)
      }, 0)
    }, [mentionStart, value, onChange])

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      onChange(newValue)

      const cursorPos = e.target.selectionStart
      // Look backwards from cursor for an @ that starts a mention
      const textBefore = newValue.slice(0, cursorPos)
      const atIndex = textBefore.lastIndexOf('@')

      if (atIndex >= 0) {
        // Check that @ is at start of input or preceded by whitespace
        const charBefore = atIndex > 0 ? textBefore[atIndex - 1] : ' '
        if (charBefore === ' ' || charBefore === '\n' || atIndex === 0) {
          const partial = textBefore.slice(atIndex + 1)
          // Only show dropdown if no newline after @
          if (!partial.includes('\n')) {
            setMentionStart(atIndex)
            setQuery(partial)
            setSelectedIndex(0)
            setShowDropdown(true)
            return
          }
        }
      }
      setShowDropdown(false)
      setMentionStart(null)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showDropdown && filtered.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex(i => (i + 1) % filtered.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex(i => (i - 1 + filtered.length) % filtered.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          insertMention(filtered[selectedIndex])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowDropdown(false)
          return
        }
      }
      onKeyDown?.(e)
    }

    // Close dropdown on click outside
    useEffect(() => {
      function handleClick(e: MouseEvent) {
        if (
          dropdownRef.current &&
          !dropdownRef.current.contains(e.target as Node) &&
          textareaRef.current &&
          !textareaRef.current.contains(e.target as Node)
        ) {
          setShowDropdown(false)
        }
      }
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }, [])

    // Scroll selected item into view
    useEffect(() => {
      if (!showDropdown || !dropdownRef.current) return
      const items = dropdownRef.current.querySelectorAll('[data-mention-item]')
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex, showDropdown])

    return (
      <div className="relative flex-1">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          className={className}
          autoFocus={autoFocus}
        />
        {showDropdown && filtered.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md z-50"
          >
            {filtered.map((item, i) => {
              const Icon = typeIcon[item.type]
              return (
                <button
                  key={`${item.type}-${item.id}`}
                  data-mention-item
                  type="button"
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2 ${
                    i === selectedIndex ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    insertMention(item)
                  }}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <Icon className="h-3 w-3 shrink-0 opacity-50" />
                  <span>{item.displayName}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }
)
