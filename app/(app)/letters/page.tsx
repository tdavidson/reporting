'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, FileText, Loader2, Trash2, Upload, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'
import { useFeatureVisibility } from '@/components/feature-visibility-context'

interface LetterSummary {
  id: string
  period_year: number
  period_quarter: number
  period_label: string
  portfolio_group: string
  status: string
  is_year_end: boolean
  created_at: string
  updated_at: string
}

interface Template {
  id: string
  name: string
  source_type: string | null
  source_filename: string | null
  is_default: boolean
  created_at: string
}

export default function LettersPage() {
  const fv = useFeatureVisibility()
  const router = useRouter()
  const [letters, setLetters] = useState<LetterSummary[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [uploadingTemplate, setUploadingTemplate] = useState(false)
  const [creatingDefault, setCreatingDefault] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/lp-letters').then(r => r.json()),
      fetch('/api/lp-letters/templates').then(r => r.json()),
    ]).then(([lettersData, templatesData]) => {
      setLetters(Array.isArray(lettersData) ? lettersData : [])
      setTemplates(Array.isArray(templatesData) ? templatesData : [])
    }).finally(() => setLoading(false))
  }, [])

  const handleCreateDefault = async () => {
    setCreatingDefault(true)
    const res = await fetch('/api/lp-letters/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (res.ok) {
      const t = await res.json()
      setTemplates(prev => [t, ...prev])
    }
    setCreatingDefault(false)
    setTemplateDialogOpen(false)
  }

  const handleUploadTemplate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingTemplate(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('name', file.name.replace(/\.(docx|pdf)$/i, ''))

    const res = await fetch('/api/lp-letters/templates', {
      method: 'POST',
      body: formData,
    })
    if (res.ok) {
      const t = await res.json()
      setTemplates(prev => [t, ...prev])
    }
    setUploadingTemplate(false)
    setTemplateDialogOpen(false)
  }

  const handleDeleteTemplate = async (id: string) => {
    await fetch(`/api/lp-letters/templates/${id}`, { method: 'DELETE' })
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  const handleDeleteLetter = async (id: string) => {
    await fetch(`/api/lp-letters/${id}`, { method: 'DELETE' })
    setLetters(prev => prev.filter(l => l.id !== id))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            {fv.lp_letters === 'admin' && <Lock className="h-4 w-4 text-amber-500" />}Letters
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Quarterly LP letter drafts</p>
        </div>
        <div className="flex items-center gap-3">
          <AnalystToggleButton />
          <Button size="sm" variant="outline" onClick={() => setTemplateDialogOpen(true)}>
            Templates ({templates.length})
          </Button>
          <Link href="/letters/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              New letter
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 w-full space-y-6">
          {/* No templates notice */}
          {templates.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
              <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Set up a template first. Upload a previous LP letter to match your style, or use the default template.
              </p>
              <Button size="sm" onClick={() => setTemplateDialogOpen(true)}>
                Set up template
              </Button>
            </div>
          )}

          {/* Letters list */}
          {letters.length === 0 && templates.length > 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center space-y-4">
              <p className="text-sm text-muted-foreground">No letters yet. Create your first quarterly LP letter.</p>
              <Link href="/letters/new" className="inline-block">
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1.5" />
                  New letter
                </Button>
              </Link>
            </div>
          )}

          {letters.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left font-medium px-4 py-2.5">Period</th>
                    <th className="text-left font-medium px-4 py-2.5">Portfolio Group</th>
                    <th className="text-left font-medium px-4 py-2.5">Updated</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {letters.map(l => (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <Link href={`/letters/${l.id}`} className="font-medium hover:underline">
                          {l.period_label}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{l.portfolio_group}</td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">
                        {new Date(l.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => handleDeleteLetter(l.id)}
                          className="text-muted-foreground/50 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <AnalystPanel />
      </div>

      {/* Template management dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Letter Templates</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {templates.length > 0 && (
              <div className="space-y-2">
                {templates.map(t => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.source_type === 'default' ? 'Default template' : `Uploaded: ${t.source_filename}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteTemplate(t.id)}
                      className="text-muted-foreground/50 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={handleCreateDefault}
                disabled={creatingDefault}
              >
                {creatingDefault ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Use default
              </Button>
              <Button size="sm" variant="outline" className="relative" disabled={uploadingTemplate}>
                {uploadingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                Upload letter
                <input
                  type="file"
                  accept=".docx,.pdf"
                  onChange={handleUploadTemplate}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  disabled={uploadingTemplate}
                />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Upload a previous LP letter (.docx or .pdf) and AI will analyze it to match your style.
              Or use the built-in default template — <a href="/api/lp-letters/example" download className="underline hover:text-foreground">view an example</a>.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
