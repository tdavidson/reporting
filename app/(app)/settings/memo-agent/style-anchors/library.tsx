'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Upload, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useConfirm } from '@/components/confirm-dialog'

type Confidence = 'unavailable' | 'preliminary' | 'reliable' | 'robust'

interface AnchorListItem {
  id: string
  file_name: string
  file_format: string
  file_size_bytes: number | null
  title: string | null
  vintage_year: number | null
  vintage_quarter: string | null
  sector: string | null
  voice_representativeness: 'exemplary' | 'representative' | 'atypical' | 'do_not_match_voice'
  partner_notes: string | null
  extracted_at: string | null
  extracted_text_length?: number
  uploaded_at: string
}

const VOICE_BADGE: Record<AnchorListItem['voice_representativeness'], { label: string; cls: string }> = {
  exemplary:           { label: 'Exemplary',     cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' },
  representative:      { label: 'Representative',cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' },
  atypical:            { label: 'Atypical',      cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  do_not_match_voice:  { label: 'Do not match',  cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
}

const CONFIDENCE_NOTES: Record<Confidence, { label: string; help: string; cls: string }> = {
  unavailable:  { label: 'Voice match unavailable', help: 'Upload at least one memo to start teaching the agent your voice.', cls: 'bg-gray-100 text-gray-700' },
  preliminary:  { label: 'Preliminary voice match', help: 'With 1-2 memos the voice signal is weak. Plan to add a few more.', cls: 'bg-amber-100 text-amber-800' },
  reliable:     { label: 'Reliable voice match',    help: 'With 3-7 memos the dominant voice is captured well.', cls: 'bg-blue-100 text-blue-800' },
  robust:       { label: 'Robust voice match',      help: 'With 8+ memos voice patterns are robust across authors and vintages.', cls: 'bg-emerald-100 text-emerald-800' },
}

function nextConfidence(count: number): Confidence {
  if (count <= 0) return 'unavailable'
  if (count <= 2) return 'preliminary'
  if (count <= 7) return 'reliable'
  return 'robust'
}

export function StyleAnchorsLibrary({ initialAnchors, initialConfidence }: {
  initialAnchors: AnchorListItem[]
  initialConfidence: Confidence
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [anchors, setAnchors] = useState(initialAnchors)
  const [uploadOpen, setUploadOpen] = useState(false)

  const confidence = nextConfidence(anchors.length)
  const note = CONFIDENCE_NOTES[confidence]

  async function remove(id: string) {
    const ok = await confirm({
      title: 'Delete reference memo?',
      description: 'The file is removed from storage and will no longer inform the agent\'s voice synthesis.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    setAnchors(prev => prev.filter(a => a.id !== id))
    await fetch(`/api/firm/style-anchors/${id}`, { method: 'DELETE' })
  }

  function handleUploaded(row: AnchorListItem) {
    setAnchors(prev => [row, ...prev])
    setUploadOpen(false)
    router.refresh()
  }

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 max-w-5xl">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to settings
      </Link>

      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Style anchors</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Upload past investment memos to teach the agent your firm&rsquo;s voice and structure.
            Reference memos teach style — they never supply facts to a new memo.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)} size="sm">
          <Upload className="h-3.5 w-3.5 mr-1" /> Upload memo
        </Button>
      </div>

      <div className={`mb-6 rounded-md border p-3 text-sm dark:bg-opacity-20 ${note.cls}`}>
        <div className="font-medium">{note.label}</div>
        <div className="opacity-80 mt-0.5 text-[13px]">{note.help}</div>
      </div>

      {anchors.length === 0 ? (
        <div className="rounded-md border bg-card p-12 text-center text-sm text-muted-foreground">
          No reference memos yet. Click Upload memo to add your first.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {anchors.map(a => (
            <div key={a.id} className="rounded-md border bg-card p-4 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-2">
                <Link href={`/settings/memo-agent/style-anchors/${a.id}`} className="font-medium truncate hover:underline">
                  {a.title || a.file_name}
                </Link>
                <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-medium ${VOICE_BADGE[a.voice_representativeness].cls}`}>
                  {VOICE_BADGE[a.voice_representativeness].label}
                </span>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5 flex-1">
                <div>
                  {a.vintage_year ? `${a.vintage_year}${a.vintage_quarter ? ` ${a.vintage_quarter}` : ''}` : 'No vintage'}
                  {a.sector && ` · ${a.sector}`}
                </div>
                <div>{a.file_format.toUpperCase()} · {a.file_size_bytes ? `${(a.file_size_bytes / 1024 / 1024).toFixed(1)} MB` : '—'}</div>
                <div>
                  {a.extracted_at ? (
                    <span>Text extracted ({(a.extracted_text_length ?? 0).toLocaleString()} chars)</span>
                  ) : (
                    <span className="text-amber-600">Text extraction failed — open to retry</span>
                  )}
                </div>
                {a.partner_notes && (
                  <div className="italic mt-1 line-clamp-2">&ldquo;{a.partner_notes}&rdquo;</div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-2 border-t">
                <Link
                  href={`/settings/memo-agent/style-anchors/${a.id}`}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Edit metadata
                </Link>
                <button onClick={() => remove(a.id)} className="ml-auto text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={handleUploaded} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upload dialog
// ---------------------------------------------------------------------------

function UploadDialog({ open, onOpenChange, onUploaded }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onUploaded: (row: AnchorListItem) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [vintageYear, setVintageYear] = useState('')
  const [sector, setSector] = useState('')
  const [voice, setVoice] = useState('representative')
  const [partnerNotes, setPartnerNotes] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!file) return
    setSubmitting(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (title.trim()) fd.append('title', title.trim())
      if (vintageYear.trim()) fd.append('vintage_year', vintageYear.trim())
      if (sector.trim()) fd.append('sector', sector.trim())
      fd.append('voice_representativeness', voice)
      if (partnerNotes.trim()) fd.append('partner_notes', partnerNotes.trim())

      const res = await fetch('/api/firm/style-anchors', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Upload failed')
      }
      const row: AnchorListItem = await res.json()
      onUploaded(row)
      // Reset form
      setFile(null); setTitle(''); setVintageYear(''); setSector(''); setVoice('representative'); setPartnerNotes('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload reference memo</DialogTitle>
          <DialogDescription>PDF, DOCX, or MD. ≤20 MB. Add basic metadata now; you can fine-tune voice settings on the detail page after upload.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">File *</label>
            <Input type="file" accept=".pdf,.docx,.md,.txt,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            {file && <p className="text-[11px] text-muted-foreground mt-1">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Defaults to filename" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Vintage year</label>
              <Input value={vintageYear} onChange={e => setVintageYear(e.target.value)} placeholder="e.g. 2024" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Sector</label>
              <Input value={sector} onChange={e => setSector(e.target.value)} placeholder="e.g. dev tools" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Voice fit</label>
              <select value={voice} onChange={e => setVoice(e.target.value)} className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm">
                <option value="exemplary">Exemplary</option>
                <option value="representative">Representative</option>
                <option value="atypical">Atypical</option>
                <option value="do_not_match_voice">Do not match (read for structure only)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Partner notes</label>
            <textarea
              value={partnerNotes}
              onChange={e => setPartnerNotes(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="e.g. Gold standard for team sections; structure is right but voice is too formal"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !file}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
