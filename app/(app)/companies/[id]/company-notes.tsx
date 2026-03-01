'use client'

import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react'
import { MessageSquare, Send, Pencil, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Note {
  id: string
  content: string
  userId: string
  userName: string | null
  userEmail: string
  createdAt: string
  edited: boolean
}

interface NotesContextValue {
  open: boolean
  toggle: () => void
  companyId: string
  userId: string
  isAdmin: boolean
  inputRef: React.MutableRefObject<HTMLTextAreaElement | null>
}

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

const NotesContext = createContext<NotesContextValue | null>(null)

export function CompanyNotesLayout({
  companyId,
  userId,
  isAdmin,
  children,
}: {
  companyId: string
  userId: string
  isAdmin: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  return (
    <NotesContext.Provider value={{ open, toggle: () => setOpen(prev => !prev), companyId, userId, isAdmin, inputRef }}>
      {children}
    </NotesContext.Provider>
  )
}

export function ChatButton() {
  const ctx = useContext(NotesContext)
  if (!ctx) return null
  const { open, toggle } = ctx
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`ml-auto gap-1.5 h-8 py-2 ${open ? 'bg-accent' : ''}`}
      onClick={toggle}
    >
      <MessageSquare className="h-3.5 w-3.5" />
      Notes
    </Button>
  )
}

export function CompanyNotesPanel() {
  const ctx = useContext(NotesContext)
  if (!ctx || !ctx.open) return null
  return <NotesPanel ctx={ctx} />
}

function NotesPanel({ ctx }: { ctx: NotesContextValue }) {
  const { companyId, userId, isAdmin, inputRef, toggle } = ctx
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(false)
  const [content, setContent] = useState('')
  const [posting, setPosting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/companies/${companyId}/notes`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setNotes(data)
      })
      .finally(() => setLoading(false))
  }, [companyId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [notes])

  async function handlePost() {
    if (!content.trim() || posting) return
    setPosting(true)
    try {
      const res = await fetch(`/api/companies/${companyId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() }),
      })
      if (res.ok) {
        const note = await res.json()
        setNotes(prev => [...prev, note])
        setContent('')
        setTimeout(() => inputRef.current?.focus(), 50)
      }
    } finally {
      setPosting(false)
    }
  }

  async function handleDelete(noteId: string) {
    const res = await fetch(`/api/companies/${companyId}/notes/${noteId}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      setNotes(prev => prev.filter(n => n.id !== noteId))
    }
  }

  function startEditing(note: Note) {
    setEditingId(note.id)
    setEditContent(note.content)
  }

  async function handleEdit(noteId: string) {
    if (!editContent.trim()) return
    const res = await fetch(`/api/companies/${companyId}/notes/${noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editContent.trim() }),
    })
    if (res.ok) {
      const updated = await res.json()
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, content: updated.content, edited: updated.edited } : n))
      setEditingId(null)
      setEditContent('')
    }
  }

  return (
    <div className="w-[340px] shrink-0 sticky top-4 max-h-[calc(100vh-6rem)] rounded-lg border bg-card flex flex-col">
      <div className="px-4 py-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Notes</h2>
        <button onClick={toggle}>
          <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-3 space-y-3">
        {loading && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
        {!loading && notes.length === 0 && (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        )}
        {notes.map(note => (
          <div key={note.id} className="group">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-medium">
                {note.userName || note.userEmail.split('@')[0]}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(note.createdAt)}
              </span>
              {note.edited && (
                <span className="text-[10px] text-muted-foreground italic">edited</span>
              )}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex items-center gap-1">
                {note.userId === userId && (
                  <button onClick={() => startEditing(note)}>
                    <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
                {(note.userId === userId || isAdmin) && (
                  <button onClick={() => handleDelete(note.id)}>
                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </div>
            </div>
            {editingId === note.id ? (
              <div className="flex gap-1.5">
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleEdit(note.id)
                    }
                    if (e.key === 'Escape') {
                      setEditingId(null)
                      setEditContent('')
                    }
                  }}
                  rows={2}
                  className="flex-1 resize-none rounded-md border bg-transparent px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  autoFocus
                />
                <div className="flex flex-col gap-1 self-end">
                  <button onClick={() => handleEdit(note.id)}>
                    <Check className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                  <button onClick={() => { setEditingId(null); setEditContent('') }}>
                    <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm whitespace-pre-wrap">{note.content}</p>
            )}
          </div>
        ))}
      </div>

      <div className="px-4 py-3">
        <div className="flex gap-2">
          <textarea
            ref={(el) => { inputRef.current = el }}
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handlePost()
              }
            }}
            placeholder="Write a note..."
            rows={2}
            className="flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            size="icon"
            onClick={handlePost}
            disabled={!content.trim() || posting}
            className="h-auto self-end px-2 py-2"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
