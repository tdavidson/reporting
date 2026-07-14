'use client'

import { useEffect, useState } from 'react'
import { Loader2, Link2, RefreshCw, Search, Unlink, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Link a deal to an Affinity company and pull its notes + attached files into
 * the data room.
 *
 * Two paths, deliberately both present:
 *   - "Import now" for the impatient case (partner just linked the deal, wants
 *     the CRM history in front of the memo agent immediately).
 *   - A background sync (hourly cron) that keeps pulling new notes as colleagues
 *     write them, so the data room doesn't silently go stale.
 */

interface AffinityOrg {
  id: number
  name: string
  domain: string | null
}

interface LinkStatus {
  linked: boolean
  organization_id: number | null
  last_synced_at: string | null
  caller_connected: boolean
  sync_active: boolean
}

type ImportEvent =
  | { type: 'log'; message: string }
  | { type: 'listed'; notes: number; files: number }
  | { type: 'progress'; current: number; total: number; item: string }
  | { type: 'imported'; item: string; kind: 'note' | 'file' }
  | { type: 'skipped'; item: string; reason: string }
  | { type: 'error'; item: string; error: string }
  | { type: 'done'; imported: number; skipped: number; errors: number }

export function AffinityPanel({
  dealId,
  dealName,
  onImported,
}: {
  dealId: string
  dealName: string
  onImported: () => void
}) {
  const [status, setStatus] = useState<LinkStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState(dealName)
  const [results, setResults] = useState<AffinityOrg[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [importing, setImporting] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/diligence/${dealId}/affinity`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setStatus(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [dealId])

  async function search() {
    setSearching(true)
    setError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/affinity?search=${encodeURIComponent(term)}`)
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Search failed')
        setResults([])
      } else {
        setResults(body.organizations ?? [])
        if ((body.organizations ?? []).length === 0) {
          setError(`No companies in Affinity match "${term}".`)
        }
      }
    } catch {
      setError('Could not reach Affinity.')
    } finally {
      setSearching(false)
    }
  }

  async function link(org: AffinityOrg) {
    setError(null)
    const res = await fetch(`/api/diligence/${dealId}/affinity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: org.id }),
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? 'Could not link')
      return
    }
    setStatus(s => ({
      ...(s ?? { caller_connected: true }),
      linked: true,
      organization_id: org.id,
      last_synced_at: null,
      sync_active: true,
    } as LinkStatus))
    setOpen(false)
    // Linking without importing would leave the partner staring at an unchanged
    // data room, so pull straight away.
    runImport()
  }

  async function unlink() {
    await fetch(`/api/diligence/${dealId}/affinity`, { method: 'DELETE' })
    setStatus(s => s ? { ...s, linked: false, organization_id: null, sync_active: false } : s)
  }

  async function runImport() {
    setImporting(true)
    setLines([])
    setProgress(null)
    setError(null)

    try {
      const res = await fetch(`/api/diligence/${dealId}/documents/from-affinity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Import failed')
        setImporting(false)
        return
      }

      // NDJSON stream — one event per line.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          if (!part.trim()) continue
          let event: ImportEvent
          try { event = JSON.parse(part) } catch { continue }
          applyEvent(event)
        }
      }

      onImported()
    } catch {
      setError('Import stream failed.')
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }

  function applyEvent(event: ImportEvent) {
    switch (event.type) {
      case 'log':
        setLines(l => [...l, event.message])
        break
      case 'listed':
        setLines(l => [...l, `Found ${event.notes} note${event.notes === 1 ? '' : 's'} and ${event.files} file${event.files === 1 ? '' : 's'} in Affinity.`])
        break
      case 'progress':
        setProgress({ current: event.current, total: event.total })
        break
      case 'imported':
        setLines(l => [...l, `✓ ${event.item}`])
        break
      case 'skipped':
        setLines(l => [...l, `– ${event.item} (${event.reason})`])
        break
      case 'error':
        setLines(l => [...l, `✗ ${event.item}: ${event.error}`])
        break
      case 'done':
        setLines(l => [...l, `Done — ${event.imported} imported, ${event.skipped} skipped, ${event.errors} error${event.errors === 1 ? '' : 's'}.`])
        break
    }
  }

  if (!status) return null

  // Nothing to offer until the user connects their own Affinity key.
  if (!status.caller_connected && !status.linked) {
    return null
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {!status.linked ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Link2 className="h-3.5 w-3.5 mr-1" /> Link Affinity
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={runImport}
            disabled={importing || !status.caller_connected}
            title={
              status.caller_connected
                ? 'Pull any new Affinity notes and files into the data room'
                : 'Connect your Affinity account in Settings to import'
            }
          >
            {importing
              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            {importing ? 'Importing…' : 'Pull from Affinity'}
          </Button>
        )}
      </div>

      {status.linked && !status.sync_active && (
        <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
          <AlertCircle className="h-3 w-3" />
          Background sync is paused — the person who linked this deal has disconnected Affinity.
        </p>
      )}

      {/* Import progress */}
      {(importing || lines.length > 0) && (
        <div className="mt-2 rounded-md border bg-muted/30 p-3 text-xs">
          {progress && (
            <div className="mb-2 text-muted-foreground">
              {progress.current} of {progress.total}…
            </div>
          )}
          <div className="max-h-40 overflow-y-auto space-y-0.5 font-mono">
            {lines.map((line, i) => (
              <div key={i} className="text-muted-foreground">{line}</div>
            ))}
          </div>
          {!importing && lines.length > 0 && (
            <button
              className="mt-2 text-muted-foreground underline"
              onClick={() => setLines([])}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      )}

      {status.linked && (
        <p className="mt-1 text-xs text-muted-foreground">
          Linked to Affinity company #{status.organization_id}
          {status.last_synced_at
            ? ` · last synced ${new Date(status.last_synced_at).toLocaleString()}`
            : ' · not yet synced'}
          {' · '}
          <button className="underline" onClick={unlink}>
            <Unlink className="h-3 w-3 inline mr-0.5" />unlink
          </button>
        </p>
      )}

      {/* Link dialog */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-lg border bg-card p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-1">Link to Affinity</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Find this company in your Affinity. Once linked, its notes and attached files are
              pulled into the data room, and new notes keep syncing hourly.
            </p>

            <div className="flex gap-2">
              <Input
                value={term}
                onChange={e => setTerm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') search() }}
                placeholder="Company name or domain"
                autoFocus
              />
              <Button onClick={search} disabled={searching || !term.trim()}>
                {searching
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

            <div className="mt-3 max-h-64 overflow-y-auto divide-y">
              {results.map(org => (
                <button
                  key={org.id}
                  onClick={() => link(org)}
                  className="w-full text-left py-2 px-1 hover:bg-muted/50 rounded"
                >
                  <div className="text-sm font-medium">{org.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {org.domain ?? 'no domain'} · Affinity #{org.id}
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
