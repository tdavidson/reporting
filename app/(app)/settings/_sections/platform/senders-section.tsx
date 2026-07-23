'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react'
import { Section } from '@/components/settings/section'
import type { Sender } from '../types'

export function SendersSection({
  senders,
  onChanged,
}: {
  senders: Sender[]
  onChanged: () => void
}) {
  const [email, setEmail] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const handleAdd = async () => {
    if (!email.trim()) return
    setAdding(true)
    const res = await fetch('/api/settings/senders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, label }),
    })
    setAdding(false)
    if (res.ok) {
      setEmail('')
      setLabel('')
      onChanged()
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const res = await fetch(`/api/settings/senders/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (res.ok) onChanged()
  }

  return (
    <Section title="Authorized senders">
      <p className="text-xs text-muted-foreground mb-3">
        Only emails from these addresses will be processed.
      </p>

      {senders.length > 0 && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`} />
            {senders.length} sender{senders.length !== 1 ? 's' : ''}
          </button>
          {expanded && (
            <div className="border rounded-lg divide-y">
              {senders.map((s) => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <span className="text-sm">{s.email}</span>
                    {s.label && (
                      <span className="text-xs text-muted-foreground ml-2">({s.label})</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(s.id)}
                    disabled={deletingId === s.id}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
        <div className="flex-1">
          <Label>Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="founder@company.com"
          />
        </div>
        <div className="sm:w-32">
          <Label>Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="optional"
          />
        </div>
        <Button onClick={handleAdd} disabled={adding || !email.trim()} size="sm">
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </Section>
  )
}
