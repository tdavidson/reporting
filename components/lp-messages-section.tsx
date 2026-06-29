'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check } from 'lucide-react'

interface Msg {
  id: string
  from_email: string | null
  subject: string | null
  body: string
  status: string
  created_at: string
  investor_name: string | null
}

export function LpMessagesSection() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/lps/messages')
      const b = r.ok ? await r.json() : { messages: [] }
      setMessages(b.messages ?? [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function setStatus(id: string, status: 'open' | 'resolved') {
    setBusy(id)
    try {
      const r = await fetch('/api/lps/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (r.ok) setMessages(prev => prev.map(m => (m.id === id ? { ...m, status } : m)))
    } finally {
      setBusy(null)
    }
  }

  const open = messages.filter(m => m.status !== 'resolved')
  const resolved = messages.filter(m => m.status === 'resolved')
  const shown = showResolved ? messages : open

  return (
    <div>
      <h4 className="text-sm font-medium mb-1 flex items-center gap-2">
        LP messages
        {open.length > 0 && <span className="text-xs bg-muted rounded-full px-1.5 py-0.5 text-muted-foreground">{open.length}</span>}
      </h4>
      <p className="text-xs text-muted-foreground mb-2">Questions LPs sent from their portal&apos;s Contact form. Admins are emailed too.</p>
      {loading ? (
        <div className="text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" /> Loading…</div>
      ) : messages.length === 0 ? (
        <div className="text-xs text-muted-foreground rounded-md border bg-card p-4">No messages yet.</div>
      ) : (
        <>
          <div className="rounded-md border bg-card divide-y">
            {shown.map(m => (
              <div key={m.id} className="p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">
                      {m.created_at ? new Date(m.created_at).toLocaleString() : ''}
                      {m.investor_name ? ` · ${m.investor_name}` : ''}
                      {m.from_email ? ` · ${m.from_email}` : ''}
                      {m.status === 'resolved' ? ' · resolved' : ''}
                    </div>
                    {m.subject && <div className="font-medium mt-0.5">{m.subject}</div>}
                    <div className="text-sm whitespace-pre-wrap mt-0.5">{m.body}</div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {m.from_email && (
                      <a href={`mailto:${m.from_email}${m.subject ? `?subject=${encodeURIComponent(`Re: ${m.subject}`)}` : ''}`} className="text-[11px] text-primary hover:underline">Reply</a>
                    )}
                    {m.status === 'resolved' ? (
                      <button onClick={() => setStatus(m.id, 'open')} disabled={busy === m.id} className="text-[11px] text-muted-foreground hover:text-foreground">Reopen</button>
                    ) : (
                      <button onClick={() => setStatus(m.id, 'resolved')} disabled={busy === m.id} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                        {busy === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Resolve
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {resolved.length > 0 && (
            <button onClick={() => setShowResolved(s => !s)} className="text-[11px] text-muted-foreground hover:text-foreground mt-2">
              {showResolved ? 'Hide resolved' : `Show resolved (${resolved.length})`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
