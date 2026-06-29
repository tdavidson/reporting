'use client'

import { useState } from 'react'
import { Loader2, Check, Send } from 'lucide-react'

export default function PortalContactPage() {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="max-w-xl">
        <div className="rounded-md border bg-card p-8 text-center">
          <Check className="h-6 w-6 mx-auto text-green-600 dark:text-green-400 mb-2" />
          <div className="text-sm font-medium">Message sent</div>
          <p className="text-sm text-muted-foreground mt-1">Your fund has received your message and will follow up by email.</p>
          <button onClick={() => setSent(false)} className="mt-4 text-xs text-primary hover:underline">Send another</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Contact your fund</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Have a question about your investment, a statement, or a document? Send a message and the team will get back to you by email.
        </p>
      </div>
      <div className="rounded-md border bg-card p-4 space-y-3">
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
    </div>
  )
}
