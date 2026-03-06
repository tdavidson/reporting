'use client'

import { useEffect, useState, useCallback } from 'react'
import { FileText, Trash2, Loader2, ChevronDown, ChevronRight, FileSpreadsheet, FileImage, File, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Document {
  id: string
  filename: string
  file_type: string
  file_size: number
  has_native_content?: boolean
  created_at: string
  source: 'upload' | 'email'
  email_subject?: string
}

interface Props {
  companyId: string
  storageProvider?: string | null
  googleDriveFolderId?: string | null
  dropboxFolderPath?: string | null
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileIcon({ fileType, source }: { fileType: string; source: string }) {
  if (source === 'email') {
    return <Mail className="h-3.5 w-3.5 text-blue-500 shrink-0" />
  }
  if (fileType === 'application/pdf' || fileType.endsWith('.pdf')) {
    return <FileText className="h-3.5 w-3.5 text-red-500 shrink-0" />
  }
  if (fileType.startsWith('image/')) {
    return <FileImage className="h-3.5 w-3.5 text-blue-500 shrink-0" />
  }
  if (fileType.includes('spreadsheet') || fileType.includes('excel') || fileType.includes('csv')) {
    return <FileSpreadsheet className="h-3.5 w-3.5 text-green-600 shrink-0" />
  }
  return <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
}

export function CompanyDocuments({ companyId, storageProvider, googleDriveFolderId, dropboxFolderPath }: Props) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${companyId}/documents`)
      if (res.ok) {
        const data = await res.json()
        setDocuments(data.documents)
      }
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { load() }, [load])

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
          <span className="text-sm font-medium text-muted-foreground">Documents</span>
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
          Documents
          {documents.length > 0 && (
            <span className="text-xs bg-muted rounded-full px-1.5 py-0.5">{documents.length}</span>
          )}
        </button>
      </div>

      {error && (
        <p className="text-sm text-destructive mb-2">{error}</p>
      )}

      {expanded && documents.length > 0 && (
        <div className="space-y-1">
          {documents.map(doc => (
            <div
              key={doc.id}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border bg-card text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon fileType={doc.file_type} source={doc.source} />
                <span className="truncate">{doc.filename}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatFileSize(doc.file_size)}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(doc.created_at).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric',
                  })}
                </span>
              </div>
              {doc.source === 'upload' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(doc.id)}
                  disabled={deletingId === doc.id}
                  className="h-7 px-2 text-muted-foreground hover:text-destructive shrink-0"
                >
                  {deletingId === doc.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {expanded && documents.length > 0 && (
        <p className="text-xs text-muted-foreground/70 px-3 pt-2">
          Documents listed here show what was used for AI extraction.{' '}
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
          ) : storageProvider === 'dropbox' && dropboxFolderPath ? (
            <>
              Raw documents can be found in{' '}
              <a
                href={`https://www.dropbox.com/home${dropboxFolderPath}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Dropbox
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
          No documents yet. Upload files from the Analyst above, or documents will appear here from email attachments.
        </p>
      )}
    </div>
  )
}
