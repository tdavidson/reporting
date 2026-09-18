'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, Send, Megaphone, CornerDownRight } from 'lucide-react'

interface Message {
  id: string
  fund: string
  subject: string | null
  body: string
  created_at: string
  from: 'you' | 'fund'
  kind: 'message' | 'reply' | 'announcement'
  parent_id: string | null
}

const fmtWhen = (s: string) => (s ? new Date(s).toLocaleString() : '')

export default function PortalContactPage() {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Message[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  function loadHistory() {
    fetch('/api/portal/messages')
      .then(r => (r.ok ? r.json() : { messages: [] }))
      .then(d => setHistory(d.messages ?? []))
      .catch(() => {})
      .finally(() => setLoadingHistory(false))
  }
  useEffect(() => { loadHistory() }, [])

  async function submit() {
    if (!message.trim()) return
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/portal/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(b.error ?? 'Failed to send')
      setSent(true); setSubject(''); setMessage('')
      loadHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  // Threads: each message you sent with the fund's replies under it; announcements on their own.
  const threads = history.filter(m => m.kind === 'message').slice().reverse()
  const repliesFor = (id: string) => history.filter(m => m.kind === 'reply' && m.parent_id === id)
  const announcements = history.filter(m => m.kind === 'announcement').slice().reverse()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Contact your fund</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Have a question about your investment, a statement, or a document? Send a message and the team will reply here and by email.
        </p>
      </div>

      {sent ? (
        <div className="rounded-card border bg-card p-8 text-center">
          <Check className="h-6 w-6 mx-auto text-success mb-2" />
          <div className="text-sm font-medium">Message sent</div>
          <p className="text-sm text-muted-foreground mt-1">Your fund has received your message and will follow up here and by email.</p>
          <button onClick={() => setSent(false)} className="mt-4 text-xs text-primary hover:underline">Send another</button>
        </div>
      ) : (
        <div className="rounded-card border bg-card p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Subject (optional)</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Question about my Q4 statement"
              className="h-9 w-full px-3 rounded-md border border-input bg-background text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Message</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={6}
              placeholder="Write your message…"
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <button
              onClick={submit}
              disabled={sending || !message.trim()}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send message
            </button>
          </div>
        </div>
      )}

      {loadingHistory ? null : (threads.length > 0 || announcements.length > 0) && (
        <div className="space-y-6">
          {announcements.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">From your fund</h2>
              <div className="rounded-card border bg-card divide-y">
                {announcements.map(a => (
                  <div key={a.id} className="p-4 text-sm">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Megaphone className="h-3.5 w-3.5" /> {a.fund} · {fmtWhen(a.created_at)}</div>
                    {a.subject && <div className="font-medium mt-1">{a.subject}</div>}
                    <div className="whitespace-pre-wrap mt-1">{a.body}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {threads.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">Your messages</h2>
              <div className="rounded-card border bg-card divide-y">
                {threads.map(t => (
                  <div key={t.id} className="p-4 text-sm space-y-2">
                    <div>
                      <div className="text-xs text-muted-foreground">You · {fmtWhen(t.created_at)}</div>
                      {t.subject && <div className="font-medium mt-0.5">{t.subject}</div>}
                      <div className="whitespace-pre-wrap mt-0.5">{t.body}</div>
                    </div>
                    {repliesFor(t.id).map(r => (
                      <div key={r.id} className="flex gap-2 rounded-md bg-muted/40 px-3 py-2">
                        <CornerDownRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">{r.fund} · {fmtWhen(r.created_at)}</div>
                          <div className="whitespace-pre-wrap">{r.body}</div>
                        </div>
                      </div>
                    ))}
                    {repliesFor(t.id).length === 0 && <div className="text-xs text-muted-foreground">Awaiting a reply.</div>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
