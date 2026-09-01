'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Mail, Paperclip, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Inbound emails the router matched to this deal, waiting for a human to accept
 * them into the data room.
 *
 * Nothing here is imported automatically. The router only proposes: a mailbox is
 * a firehose, and a wrong match would put a stranger's attachment in front of the
 * memo agent as evidence. The partner picks the deal's emails — and which of
 * their attachments are worth keeping (dropping signatures, logos, tracking
 * pixels).
 */

interface PendingAttachment {
  index: number
  name: string
  content_type: string
  size_bytes: number
}

interface PendingEmail {
  id: string
  subject: string | null
  from_address: string | null
  received_at: string | null
  confidence: number | null
  reasoning: string | null
  body_preview: string
  attachments: PendingAttachment[]
}

export function EmailIntakeTray({
  dealId,
  onAccepted,
}: {
  dealId: string
  onAccepted: () => void
}) {
  const [emails, setEmails] = useState<PendingEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Per-email attachment selection. Defaults to "take everything"; the partner
  // unticks what they don't want.
  const [selection, setSelection] = useState<Record<string, Set<number>>>({})
  const [includeBody, setIncludeBody] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/diligence/${dealId}/email-intake`)
      if (!res.ok) return
      const body = await res.json()
      const rows = (body.emails ?? []) as PendingEmail[]
      setEmails(rows)
      setSelection(prev => {
        const next = { ...prev }
        for (const e of rows) {
          if (!next[e.id]) next[e.id] = new Set(e.attachments.map(a => a.index))
        }
        return next
      })
      setIncludeBody(prev => {
        const next = { ...prev }
        for (const e of rows) if (next[e.id] === undefined) next[e.id] = true
        return next
      })
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => { load() }, [load])

  function toggleAttachment(emailId: string, index: number) {
    setSelection(prev => {
      const set = new Set(prev[emailId] ?? [])
      if (set.has(index)) set.delete(index)
      else set.add(index)
      return { ...prev, [emailId]: set }
    })
  }

  async function accept(email: PendingEmail) {
    setBusyId(email.id)
    setError(null)
    try {
      const res = await fetch(`/api/emails/${email.id}/accept-to-diligence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal_id: dealId,
          attachment_indexes: Array.from(selection[email.id] ?? []),
          include_body: includeBody[email.id] !== false,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Could not add to the data room.')
        return
      }
      setEmails(prev => prev.filter(e => e.id !== email.id))
      onAccepted()
    } catch {
      setError('Could not add to the data room.')
    } finally {
      setBusyId(null)
    }
  }

  async function reject(email: PendingEmail) {
    setBusyId(email.id)
    setError(null)
    try {
      const res = await fetch(`/api/emails/${email.id}/reroute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'reporting' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Could not process the email as reporting.')
        return
      }
      setEmails(prev => prev.filter(e => e.id !== email.id))
    } catch {
      setError('Could not process the email as reporting.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading || emails.length === 0) return null

  return (
    <div className="mb-4 rounded-card border border-warning/60 bg-warning-subtle/50 dark:bg-warning-subtle/20 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Mail className="h-4 w-4 text-warning" />
        <h3 className="text-base font-semibold">
          {emails.length} inbound email{emails.length === 1 ? '' : 's'} matched to this deal
        </h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Nothing is added to the data room until you accept it. Pick which attachments to keep.
      </p>

      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}

      <div className="space-y-3">
        {emails.map(email => {
          const selected = selection[email.id] ?? new Set<number>()
          const busy = busyId === email.id
          return (
            <div key={email.id} className="rounded-card border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {email.subject || '(no subject)'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {email.from_address ?? 'unknown sender'}
                    {email.received_at && ` · ${new Date(email.received_at).toLocaleString()}`}
                    {typeof email.confidence === 'number' &&
                      ` · match confidence ${(email.confidence * 100).toFixed(0)}%`}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" onClick={() => accept(email)} disabled={busy}>
                    {busy
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Check className="h-3.5 w-3.5 mr-1" />}
                    {busy ? '' : 'Accept'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => reject(email)} disabled={busy} className="gap-1.5">
                    <X className="h-3.5 w-3.5" />
                    Not diligence — report
                  </Button>
                </div>
              </div>

              {email.body_preview && (
                <p className="mt-2 text-xs text-muted-foreground line-clamp-3">
                  {email.body_preview}
                </p>
              )}

              <label className="mt-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={includeBody[email.id] !== false}
                  onChange={e =>
                    setIncludeBody(prev => ({ ...prev, [email.id]: e.target.checked }))
                  }
                />
                Add the email text itself as a document
              </label>

              {email.attachments.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Paperclip className="h-3 w-3" />
                    Attachments
                  </div>
                  {email.attachments.map(att => (
                    <label key={att.index} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={selected.has(att.index)}
                        onChange={() => toggleAttachment(email.id, att.index)}
                      />
                      <span className="truncate">{att.name}</span>
                      <span className="text-muted-foreground shrink-0">
                        {formatSize(att.size_bytes)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
