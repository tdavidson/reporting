'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react'
import { Section } from '@/components/settings/section'

interface WhitelistEntry {
  id: string
  email_pattern: string
  created_at: string
}

export function WhitelistSection() {
  const [entries, setEntries] = useState<WhitelistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [pattern, setPattern] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/whitelist')
    if (res.ok) {
      const data = await res.json()
      setEntries(data.entries)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!pattern.trim()) return
    setAdding(true)
    setError(null)
    const res = await fetch('/api/settings/whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailPattern: pattern }),
    })
    setAdding(false)
    if (res.ok) {
      setPattern('')
      load()
    } else {
      const data = await res.json()
      setError(data.error)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const res = await fetch(`/api/settings/whitelist/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (res.ok) load()
  }

  return (
    <Section title="Signup whitelist">
      <p className="text-xs text-muted-foreground mb-3">
        Only these emails or domains can create accounts. Use <code className="text-[11px] bg-muted px-1 rounded">*@domain.com</code> to allow an entire domain.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...
        </div>
      ) : (
        <>
          {entries.length > 0 && (
            <div className="border rounded-lg divide-y mb-3">
              {entries.map((e) => (
                <div key={e.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm font-mono">{e.email_pattern}</span>
                  <button
                    onClick={() => handleDelete(e.id)}
                    disabled={deletingId === e.id}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
            <div className="flex-1">
              <Label>Email or domain pattern</Label>
              <Input
                value={pattern}
                onChange={(e) => { setPattern(e.target.value); setError(null) }}
                placeholder="user@example.com or *@example.com"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
              />
            </div>
            <Button onClick={handleAdd} disabled={adding || !pattern.trim()} size="sm">
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {error && (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {error}
            </p>
          )}
        </>
      )}
    </Section>
  )
}
