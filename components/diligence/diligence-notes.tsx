'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { MessageSquare, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MobileDrawerPanel } from '@/components/mobile-drawer-panel'

interface Note {
  id: string
  body: string
  authorId: string | null
  authorName: string | null
  authorEmail: string | null
  createdAt: string
  updatedAt: string
}

interface DiligenceNotesContextValue {
  dealId: string
  userId: string
  isAdmin: boolean
  open: boolean
  setOpen: (v: boolean) => void
  toggle: () => void
}

const DiligenceNotesContext = createContext<DiligenceNotesContextValue | null>(null)

function useDiligenceNotes() {
  const ctx = useContext(DiligenceNotesContext)
  if (!ctx) throw new Error('useDiligenceNotes must be used inside DiligenceNotesProvider')
  return ctx
}

export function DiligenceNotesProvider({ dealId, userId, isAdmin, children }: {
  dealId: string
  userId: string
  isAdmin: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <DiligenceNotesContext.Provider value={{
      dealId, userId, isAdmin, open, setOpen,
      toggle: () => setOpen(v => !v),
    }}>
      {children}
    </DiligenceNotesContext.Provider>
  )
}

export function DiligenceNotesButton() {
  const { open, toggle } = useDiligenceNotes()
  return (
    <Button
      variant="outline"
      size="sm"
      className={`gap-1.5 h-8 py-2 text-muted-foreground hover:text-foreground ${open ? 'bg-accent' : ''}`}
      onClick={toggle}
    >
      <MessageSquare className="h-3.5 w-3.5" />
      Notes
    </Button>
  )
}

export function DiligenceNotesPanel() {
  const { open, setOpen } = useDiligenceNotes()
  return (
    <MobileDrawerPanel open={open} onOpenChange={(o) => setOpen(o)}>
      <NotesPanelInner />
    </MobileDrawerPanel>
  )
}

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function NotesPanelInner() {
  const { dealId, userId, isAdmin, setOpen } = useDiligenceNotes()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(false)
  const [content, setContent] = useState('')
  const [posting, setPosting] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/diligence/${dealId}/notes`)
      if (res.ok) {
        const data: Note[] = await res.json()
        setNotes(data)
      }
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [notes])

  async function handlePost() {
    if (!content.trim() || posting) return
    setPosting(true)
    try {
      const res = await fetch(`/api/diligence/${dealId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: content.trim() }),
      })
      if (res.ok) {
        const row: Note = await res.json()
        setNotes(prev => [...prev, row])
        setContent('')
        setTimeout(() => inputRef.current?.focus(), 50)
      }
    } finally {
      setPosting(false)
    }
  }

  async function handleDelete(noteId: string) {
    const res = await fetch(`/api/diligence/${dealId}/notes/${noteId}`, { method: 'DELETE' })
    if (res.ok) setNotes(prev => prev.filter(n => n.id !== noteId))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="max-h-[80vh] lg:max-h-[calc(100vh-6rem)] rounded-lg border bg-card flex flex-col flex-1">
        <div className="px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Notes</h2>
          <button onClick={() => setOpen(false)} className="hidden lg:block">
            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-3 space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
          {notes.map(note => {
            const isMine = note.authorId === userId
            const canDelete = isMine || isAdmin
            const displayName = note.authorName || note.authorEmail?.split('@')[0] || 'Unknown'
            return (
              <div key={note.id} className="group">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-medium">{displayName}</span>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(note.createdAt)}</span>
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="md:opacity-0 md:group-hover:opacity-100 transition-opacity ml-auto"
                    >
                      <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">{note.body}</p>
              </div>
            )
          })}
        </div>

        <div className="px-4 py-3">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handlePost()
                }
              }}
              placeholder="Write a note…"
              rows={2}
              className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
    </div>
  )
}
