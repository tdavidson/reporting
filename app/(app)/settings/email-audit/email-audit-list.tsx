'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface AuditEmail {
  id: string
  from_address: string
  subject: string | null
  received_at: string | null
  routing_confidence: number | null
  routing_reasoning: string | null
  routing_secondary_label: string | null
}

const TARGETS = [
  { value: 'reporting', label: 'Reporting' },
  { value: 'interactions', label: 'Interactions' },
  { value: 'deals', label: 'Deals' },
] as const

export function EmailAuditList({ emails: initial }: { emails: AuditEmail[] }) {
  const router = useRouter()
  const [emails, setEmails] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)

  async function reroute(id: string, to: string) {
    setBusy(id)
    const res = await fetch(`/api/emails/${id}/reroute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to }),
    })
    setBusy(null)
    if (res.ok) {
      setEmails(emails.filter(e => e.id !== id))
      router.refresh()
    }
  }

  if (emails.length === 0) {
    return (
      <div className="rounded-md border bg-card p-12 text-center text-sm text-muted-foreground">
        No emails in audit. The classifier hasn't dropped anything yet.
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-card divide-y">
      {emails.map(e => (
        <div key={e.id} className="p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{e.received_at ? new Date(e.received_at).toLocaleString() : '—'}</span>
                {e.routing_confidence !== null && <span>· conf {e.routing_confidence.toFixed(2)}</span>}
                {e.routing_secondary_label && <span>· secondary: {e.routing_secondary_label}</span>}
              </div>
              <div className="font-medium truncate">{e.subject ?? '(no subject)'}</div>
              <div className="text-xs text-muted-foreground truncate">{e.from_address}</div>
              {e.routing_reasoning && (
                <div className="text-xs text-muted-foreground italic mt-1">"{e.routing_reasoning}"</div>
              )}
            </div>
            <div className="flex flex-wrap gap-1 shrink-0">
              {TARGETS.map(t => (
                <Button
                  key={t.value}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={busy === e.id}
                  onClick={() => reroute(e.id, t.value)}
                >
                  → {t.label}
                </Button>
              ))}
              <Link href={`/emails/${e.id}`} className="inline-flex items-center px-2 h-7 text-xs text-muted-foreground hover:text-foreground">
                View
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
