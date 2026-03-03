'use client'

import { useState, useEffect, useCallback } from 'react'
import { Building2 } from 'lucide-react'
import Link from 'next/link'
import { NoteContent } from '@/components/note-content'

interface Note {
  id: string
  content: string
  userId: string
  userName: string | null
  userEmail: string
  companyId: string | null
  companyName: string | null
  mentionedUserIds: string[]
  isRead: boolean
  createdAt: string
  edited: boolean
}

type FilterMode = 'all' | 'general' | 'mentions'

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterMode>('all')

  const markAsRead = useCallback((notesList: Note[]) => {
    const unreadIds = notesList.filter(n => !n.isRead).map(n => n.id)
    if (unreadIds.length === 0) return
    fetch('/api/notes/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteIds: unreadIds }),
    }).catch(() => {})
    setNotes(prev => prev.map(n => unreadIds.includes(n.id) ? { ...n, isRead: true } : n))
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = filter !== 'all' ? `?filter=${filter}` : ''
    fetch(`/api/notes${params}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setNotes(data)
          markAsRead(data)
        }
      })
      .finally(() => setLoading(false))
  }, [filter, markAsRead])

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
          <p className="text-sm text-muted-foreground mt-1">Activity and conversations across your portfolio</p>
        </div>
        <div className="flex items-center rounded-md border text-xs">
          {(['all', 'mentions', 'general'] as FilterMode[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 capitalize transition-colors ${
                f === 'all' ? 'rounded-l-md' : f === 'general' ? 'rounded-r-md' : ''
              } ${
                filter === f
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f === 'mentions' ? '@Mentions' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!loading && notes.length === 0 && (
        <p className="text-sm text-muted-foreground">No notes found.</p>
      )}

      <div className="space-y-1">
        {notes.map(note => (
          <div
            key={note.id}
            className={`rounded-lg border p-4 transition-colors ${
              !note.isRead ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800/40' : 'bg-card'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              {!note.isRead && (
                <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
              )}
              <span className="text-sm font-medium">
                {note.userName || note.userEmail.split('@')[0]}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(note.createdAt)}
              </span>
              {note.edited && (
                <span className="text-[10px] text-muted-foreground italic">edited</span>
              )}
            </div>
            {note.companyName && (
              <Link
                href={`/companies/${note.companyId}`}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mb-1"
              >
                <Building2 className="h-3 w-3" />
                {note.companyName}
              </Link>
            )}
            <NoteContent content={note.content} />
          </div>
        ))}
      </div>
    </div>
  )
}
