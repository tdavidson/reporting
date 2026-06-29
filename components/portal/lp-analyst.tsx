'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sparkles, X, Send, Loader2 } from 'lucide-react'

interface Msg { role: 'user' | 'assistant'; content: string }

/**
 * LP-portal AI analyst: a right-side panel (mirroring the GP analyst UX) that
 * answers questions about the reports, letters, and documents shared with this
 * investor. Stateless — messages live only while the panel is open. The button
 * hides itself unless the fund has AI configured (GET /api/portal/analyst).
 */
export function LpAnalyst() {
  const [available, setAvailable] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/portal/analyst')
      .then(r => (r.ok ? r.json() : { available: false }))
      .then(b => setAvailable(!!b.available))
      .catch(() => {})
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, sending])

  if (!available) return null

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setInput('')
    setSending(true)
    try {
      const res = await fetch('/api/portal/analyst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const b = await res.json().catch(() => ({}))
      setMessages([...next, { role: 'assistant', content: res.ok ? (b.reply ?? '') : (b.error ?? 'Something went wrong.') }])
    } catch {
      setMessages([...next, { role: 'assistant', content: 'The assistant is unavailable right now.' }])
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5 h-8 text-muted-foreground hover:text-foreground shrink-0">
        <Sparkles className="h-3.5 w-3.5" /> Analyst
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpen(false)} aria-hidden />
          <aside className="fixed right-0 top-0 z-50 h-full w-full sm:w-[380px] bg-card border-l flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <div className="flex items-center gap-1.5 font-medium text-sm"><Sparkles className="h-4 w-4" /> Analyst</div>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Ask about your reports, letters, or documents — e.g. &ldquo;What was my NAV last quarter?&rdquo; The assistant only sees what your fund has shared with you.
                </p>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                    <div className={`inline-block max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap text-left ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                      {m.content}
                    </div>
                  </div>
                ))
              )}
              {sending && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…</div>}
            </div>

            <div className="px-4 py-3 border-t shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  rows={2}
                  placeholder="Ask a question…"
                  className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button size="icon" onClick={send} disabled={sending || !input.trim()} className="h-9 w-9 shrink-0"><Send className="h-4 w-4" /></Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">Responses are AI-generated from your shared materials and may contain errors.</p>
            </div>
          </aside>
        </>
      )}
    </>
  )
}
