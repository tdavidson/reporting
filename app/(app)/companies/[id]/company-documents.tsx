'use client'

import { useEffect, useState, useCallback } from 'react'
import { FileText, Trash2, Loader2, ChevronDown, ChevronRight, FileSpreadsheet, FileImage, File, Mail, ExternalLink, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Document {
  id: string
  filename: string
  file_type: string
  file_size: number
  has_native_content?: boolean
  has_readable_content?: boolean
  created_at: string
  source: 'upload' | 'email' | 'email_body'
  email_id?: string
  attachment_index?: number
  email_subject?: string
  email_from?: string
  text_content?: string
}

interface DocumentDetail {
  text_content: string | null
  file_url: string | null
  previewable: boolean
}

interface Props {
  companyId: string
  storageProvider?: string | null
  googleDriveFolderId?: string | null
  /**
   * Show email bodies/attachments here. False once the company has captured Company Updates —
   * the Updates section above then owns reporting mail, and this panel is uploads only.
   */
  includeEmailHistory?: boolean
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileIcon({ fileType, source }: { fileType: string; source: string }) {
  if (source === 'email' || source === 'email_body') {
    return <Mail className="h-3.5 w-3.5 text-info shrink-0" />
  }
  if (fileType === 'application/pdf' || fileType.endsWith('.pdf')) {
    return <FileText className="h-3.5 w-3.5 text-destructive shrink-0" />
  }
  if (fileType.startsWith('image/')) {
    return <FileImage className="h-3.5 w-3.5 text-info shrink-0" />
  }
  if (fileType.includes('spreadsheet') || fileType.includes('excel') || fileType.includes('csv')) {
    return <FileSpreadsheet className="h-3.5 w-3.5 text-success shrink-0" />
  }
  return <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
}

export function CompanyDocuments({ companyId, storageProvider, googleDriveFolderId, includeEmailHistory = true }: Props) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, DocumentDetail>>({})
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${companyId}/documents${includeEmailHistory ? '' : '?emails=0'}`)
      if (res.ok) {
        const data = await res.json()
        setDocuments(data.documents)
      }
    } finally {
      setLoading(false)
    }
  }, [companyId, includeEmailHistory])

  useEffect(() => { load() }, [load])

  const title = includeEmailHistory ? 'Documents & activity' : 'Documents'

  async function toggleDocument(doc: Document) {
    if (openId === doc.id) {
      setOpenId(null)
      return
    }
    setOpenId(doc.id)
    if (doc.source !== 'upload' || details[doc.id] || !doc.has_readable_content) return

    setLoadingDetailId(doc.id)
    try {
      const res = await fetch(`/api/companies/${companyId}/documents/${doc.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load document')
      setDetails(prev => ({ ...prev, [doc.id]: data }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document')
    } finally {
      setLoadingDetailId(null)
    }
  }

  async function handleDelete(docId: string) {
    setDeletingId(docId)
    setError(null)

    try {
      const res = await fetch(`/api/companies/${companyId}/documents/${docId}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.id !== docId))
      } else {
        const data = await res.json()
        setError(data.error ?? 'Failed to delete document')
      }
    } catch {
      setError('Failed to delete document')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-8 bg-muted rounded w-full" />
          <div className="h-8 bg-muted rounded w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <FileText className="h-3.5 w-3.5" />
          {title}
          {documents.length > 0 && (
            <span className="text-xs bg-muted rounded-full px-1.5 py-0.5">{documents.length}</span>
          )}
        </button>
      </div>

      {error && (
        <p className="text-sm text-destructive mb-2">{error}</p>
      )}

      {expanded && documents.length > 0 && (
        <div className="space-y-2">
          {documents.map(doc => {
            const isOpen = openId === doc.id
            const detail = details[doc.id]
            const attachmentUrl = doc.email_id && doc.attachment_index !== undefined
              ? `/api/emails/${doc.email_id}/attachment/${doc.attachment_index}`
              : null
            const canInlineAttachment = doc.file_type === 'application/pdf' || /^image\/(png|jpeg|gif|webp)$/.test(doc.file_type)
            return (
              <div key={doc.id} className="rounded-md border bg-card text-sm overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggleDocument(doc)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                    <FileIcon fileType={doc.file_type} source={doc.source} />
                    <span className="truncate font-medium">{doc.filename}</span>
                    {doc.source === 'email_body' && <span className="text-xs text-muted-foreground shrink-0">Email</span>}
                    {doc.source === 'email' && <span className="text-xs text-muted-foreground shrink-0">Attachment</span>}
                    <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(doc.file_size)}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(doc.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </button>
                  {doc.email_id && (
                    <a href={`/emails/${doc.email_id}`} className="p-1.5 text-muted-foreground hover:text-foreground" title="View source email">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {attachmentUrl && (
                    <a href={attachmentUrl} className="p-1.5 text-muted-foreground hover:text-foreground" title="Download attachment">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {doc.source === 'upload' && (
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(doc.id)} disabled={deletingId === doc.id} className="h-7 px-2 text-muted-foreground hover:text-destructive shrink-0">
                      {deletingId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
                {isOpen && (
                  <div className="border-t bg-muted/20 p-3">
                    {doc.source === 'email_body' && (
                      <>
                        {doc.email_from && <p className="text-xs text-muted-foreground mb-2">From {doc.email_from}</p>}
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm max-h-96 overflow-auto">{doc.text_content}</pre>
                      </>
                    )}
                    {doc.source === 'email' && attachmentUrl && canInlineAttachment && (
                      doc.file_type.startsWith('image/')
                        ? <img src={`${attachmentUrl}?disposition=inline`} alt={doc.filename} className="max-h-[32rem] max-w-full mx-auto rounded" />
                        : <iframe src={`${attachmentUrl}?disposition=inline`} title={doc.filename} className="w-full h-[32rem] rounded bg-white" />
                    )}
                    {doc.source === 'email' && !canInlineAttachment && <p className="text-muted-foreground">This file type cannot be previewed safely. Use the download button to open it.</p>}
                    {doc.source === 'upload' && loadingDetailId === doc.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    {doc.source === 'upload' && detail?.text_content && <pre className="whitespace-pre-wrap break-words font-sans text-sm max-h-96 overflow-auto">{detail.text_content}</pre>}
                    {doc.source === 'upload' && detail?.file_url && detail.previewable && (
                      doc.file_type.startsWith('image/')
                        ? <img src={detail.file_url} alt={doc.filename} className="max-h-[32rem] max-w-full mx-auto rounded" />
                        : <iframe src={detail.file_url} title={doc.filename} className="w-full h-[32rem] rounded bg-white" />
                    )}
                    {doc.source === 'upload' && detail?.file_url && !detail.previewable && <a href={detail.file_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Open document</a>}
                    {doc.source === 'upload' && !doc.has_readable_content && <p className="text-muted-foreground">No retained content is available for this document.</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {expanded && documents.length > 0 && (
        <p className="text-xs text-muted-foreground/70 px-3 pt-2">
          {includeEmailHistory
            ? 'Email bodies, attachments, and uploaded documents used for reporting and AI extraction appear here.'
            : 'Uploaded documents used for AI context appear here; reporting email lives in Updates above.'}{' '}
          {storageProvider === 'google_drive' && googleDriveFolderId ? (
            <>
              Raw documents can be found in{' '}
              <a
                href={`https://drive.google.com/drive/folders/${googleDriveFolderId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Google Drive
              </a>.
            </>
          ) : (
            <>
              To store and access raw documents, enable a storage option in{' '}
              <a href="/settings" className="underline underline-offset-4 hover:text-foreground">Settings</a>.
            </>
          )}
        </p>
      )}

      {expanded && documents.length === 0 && (
        <p className="text-xs text-muted-foreground px-3 py-2">
          {includeEmailHistory
            ? 'No documents or email activity yet. Upload files from the Analyst above, or process an email for this company.'
            : 'No uploaded documents yet. Upload files from the Analyst above.'}
        </p>
      )}
    </div>
  )
}
