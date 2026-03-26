'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Loader2, Check, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const NEWS_SOURCES_KEY = 'prlx:newsSources'

function getSaved(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(NEWS_SOURCES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function setSaved(sources: string[]) {
  localStorage.setItem(NEWS_SOURCES_KEY, JSON.stringify(sources))
}

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    return url.origin
  } catch { return null }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div id="news-sources" className="rounded-lg border bg-card p-5">
      <h2 className="text-sm font-medium mb-4">{title}</h2>
      {children}
    </div>
  )
}

export function NewsSourcesSection() {
  const [sources, setSources] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSavedFlag] = useState(false)

  useEffect(() => {
    setSources(getSaved())
  }, [])

  const handleAdd = () => {
    setError(null)
    const normalized = normalizeUrl(input.trim())
    if (!normalized) {
      setError('Invalid URL')
      return
    }
    if (sources.includes(normalized)) {
      setError('Already added')
      return
    }
    const next = [...sources, normalized]
    setSources(next)
    setSaved(next)
    setInput('')
    setSavedFlag(true)
    setTimeout(() => setSavedFlag(false), 2000)
  }

  const handleDelete = (src: string) => {
    const next = sources.filter(s => s !== src)
    setSources(next)
    setSaved(next)
    setSavedFlag(true)
    setTimeout(() => setSavedFlag(false), 2000)
  }

  return (
    <Section title="News portals">
      <p className="text-xs text-muted-foreground mb-4">
        Add news portals (RSS-compatible) to fetch in the News feed. Stored locally in your browser.
      </p>

      {sources.length > 0 && (
        <div className="border rounded-lg divide-y mb-4">
          {sources.map(src => (
            <div key={src} className="flex items-center justify-between px-3 py-2">
              <span className="text-sm font-mono truncate">{src}</span>
              <button
                onClick={() => handleDelete(src)}
                className="text-muted-foreground hover:text-destructive ml-2 shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
        <div className="flex-1">
          <Label>Portal URL</Label>
          <Input
            value={input}
            onChange={e => { setInput(e.target.value); setError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="https://techcrunch.com"
          />
        </div>
        <Button onClick={handleAdd} disabled={!input.trim()} size="sm">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {error && (
        <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> {error}
        </p>
      )}
      {saved && (
        <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1">
          <Check className="h-3 w-3" /> Saved
        </p>
      )}
    </Section>
  )
}
