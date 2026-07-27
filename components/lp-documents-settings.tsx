'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Upload, Trash2, FileText } from 'lucide-react'
import { LpSendControl } from '@/components/lp-send-control'

interface Investor { id: string; name: string }
interface Doc {
  id: string; title: string; file_name: string; scope: string; vehicle: string | null; size_bytes: number | null
  category: string | null; doc_date: string | null; uploaded_at: string
  lp_document_shares?: { lp_investor_id: string }[]
}

function fmtDate(d: string | null): string {
  if (!d) return ''
  const date = new Date(d.length <= 10 ? `${d}T00:00:00` : d)
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function LpDocumentsSettings() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [investors, setInvestors] = useState<Investor[]>([])
  const [vehicles, setVehicles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [docDate, setDocDate] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [scope, setScope] = useState<'fund' | 'investor' | 'vehicle'>('fund')
  const [vehicle, setVehicle] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const knownCategories = useMemo(
    () => Array.from(new Set(docs.map(d => d.category).filter((c): c is string => !!c))).sort(),
    [docs],
  )

  function load() {
    setLoading(true)
    Promise.all([
      fetch('/api/lps/documents').then(r => (r.ok ? r.json() : { documents: [] })),
      fetch('/api/lps/investors').then(r => (r.ok ? r.json() : [])),
      fetch('/api/lps/vehicles').then(r => (r.ok ? r.json() : { vehicles: [] })),
    ])
      .then(([d, inv, veh]) => {
        setDocs(d.documents ?? [])
        setInvestors((Array.isArray(inv) ? inv : []).map((i: any) => ({ id: i.id, name: i.name })))
        setVehicles(veh.vehicles ?? [])
      })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  async function upload() {
    if (!file || !title.trim()) return
    if (scope === 'investor' && selected.size === 0) { setError('Pick at least one investor.'); return }
    if (scope === 'vehicle' && !vehicle) { setError('Pick an investment vehicle.'); return }
    setUploading(true); setError(null)
    try {
      const u = await fetch('/api/lps/documents/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_name: file.name }) })
      if (!u.ok) throw new Error('Could not start upload')
      const { storage_path, token } = await u.json()
      const { error: upErr } = await supabase.storage.from('lp-documents').uploadToSignedUrl(storage_path, token, file)
      if (upErr) throw upErr
      const res = await fetch('/api/lps/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(), file_name: file.name, storage_path,
          mime_type: file.type || null, size_bytes: file.size, scope,
          category: category.trim() || null, doc_date: docDate || null,
          lp_investor_ids: scope === 'investor' ? Array.from(selected) : [],
          vehicle: scope === 'vehicle' ? vehicle : null,
        }),
      })
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? 'Save failed') }
      setTitle(''); setCategory(''); setDocDate(''); setFile(null); setSelected(new Set()); setVehicle(''); setScope('fund')
      const input = document.getElementById('lp-doc-file') as HTMLInputElement | null
      if (input) input.value = ''
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function remove(id: string) {
    setDocs(prev => prev.filter(d => d.id !== id))
    await fetch(`/api/lps/documents?id=${id}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Upload files for your LPs (fund financials, statements, …). Choose who sees each file: every LP in this fund, all investors in a specific investment vehicle, or hand-picked investors. They appear in the LP portal&apos;s Documents tab, grouped by category.
      </p>

      <div className="rounded-card border p-3 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Document title" className="h-8 text-sm flex-1 min-w-[160px]" />
          <input id="lp-doc-file" type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Input list="lp-doc-categories" value={category} onChange={e => setCategory(e.target.value)} placeholder="Category (e.g. Financials)" className="h-8 text-sm w-44" />
          <datalist id="lp-doc-categories">
            {knownCategories.map(c => <option key={c} value={c} />)}
          </datalist>
          <Input type="date" value={docDate} onChange={e => setDocDate(e.target.value)} className="h-8 text-sm w-40" title="Effective document date (optional)" />
          <select value={scope} onChange={e => setScope(e.target.value as 'fund' | 'investor' | 'vehicle')} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
            <option value="fund">All LPs in this fund</option>
            <option value="vehicle">All investors in a vehicle</option>
            <option value="investor">Specific investors</option>
          </select>
          {scope === 'vehicle' && (
            <select value={vehicle} onChange={e => setVehicle(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm max-w-[220px]">
              <option value="">{vehicles.length ? 'Select a vehicle…' : 'No vehicles found'}</option>
              {vehicles.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          <Button size="sm" onClick={upload} disabled={uploading || !file || !title.trim()}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}Upload
          </Button>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
        {scope === 'investor' && (
          <div className="rounded-md border divide-y max-h-48 overflow-y-auto">
            {investors.length === 0 ? (
              <div className="text-xs text-muted-foreground p-2">No investors yet.</div>
            ) : investors.map(i => (
              <label key={i.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/30">
                <input type="checkbox" checked={selected.has(i.id)} onChange={() => setSelected(prev => { const n = new Set(prev); n.has(i.id) ? n.delete(i.id) : n.add(i.id); return n })} className="h-3.5 w-3.5" />
                <span className="truncate">{i.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" /> Loading…</div>
      ) : docs.length === 0 ? (
        <div className="text-xs text-muted-foreground">No documents uploaded yet.</div>
      ) : (
        <div className="rounded-md border divide-y">
          {docs.map(d => (
            <div key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {d.title}
                  {d.category && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">{d.category}</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {d.scope === 'fund'
                    ? 'All LPs in fund'
                    : d.vehicle
                      ? `${d.vehicle} · ${d.lp_document_shares?.length ?? 0} investor(s)`
                      : `${d.lp_document_shares?.length ?? 0} investor(s)`} · {d.file_name}
                  {(d.doc_date || d.uploaded_at) && ` · ${fmtDate(d.doc_date) || fmtDate(d.uploaded_at)}`}
                </div>
              </div>
              <div className="shrink-0">
                <LpSendControl kind="document" id={d.id} itemTitle={d.title} />
              </div>
              <button onClick={() => remove(d.id)} className="text-muted-foreground hover:text-destructive shrink-0" title="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
