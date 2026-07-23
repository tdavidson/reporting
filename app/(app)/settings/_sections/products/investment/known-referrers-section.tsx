'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2 } from 'lucide-react'
import { Section } from '@/components/settings/section'

interface KnownReferrer {
  id: string
  email: string
  name: string | null
  notes: string | null
  created_at: string | null
}

export function KnownReferrersSection() {
  const [items, setItems] = useState<KnownReferrer[]>([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [adding, setAdding] = useState(false)

  async function load() {
    const res = await fetch('/api/known-referrers')
    if (res.ok) setItems(await res.json())
  }

  useEffect(() => { load() }, [])

  async function add() {
    if (!email.trim()) return
    setAdding(true)
    const res = await fetch('/api/known-referrers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, notes }),
    })
    setAdding(false)
    if (res.ok) {
      setEmail(''); setName(''); setNotes('')
      load()
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this referrer?')) return
    const res = await fetch(`/api/known-referrers/${id}`, { method: 'DELETE' })
    if (res.ok) setItems(items.filter(x => x.id !== id))
  }

  return (
    <Section title="Known referrers">
      <p className="text-xs text-muted-foreground mb-3">
        Email addresses of scouts and friends-of-fund whose intros and forwards should bias toward Deals.
        The classifier reads this as a soft signal, not a hard rule.
      </p>

      <div className="grid grid-cols-12 gap-2 mb-3">
        <Input className="col-span-4 h-9" placeholder="email@example.com" value={email} onChange={e => setEmail(e.target.value)} />
        <Input className="col-span-3 h-9" placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} />
        <Input className="col-span-4 h-9" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
        <Button onClick={add} disabled={adding || !email.trim()} size="sm" className="col-span-1">Add</Button>
      </div>

      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">No known referrers yet.</div>
      ) : (
        <div className="rounded border divide-y">
          {items.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2 p-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{r.email}</div>
                <div className="text-xs text-muted-foreground">
                  {r.name ?? ''}{r.name && r.notes ? ' · ' : ''}{r.notes ?? ''}
                </div>
              </div>
              <Button onClick={() => remove(r.id)} variant="ghost" size="sm">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
