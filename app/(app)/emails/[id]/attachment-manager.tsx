'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { HardDrive, Check, AlertCircle, Loader2 } from 'lucide-react'

type AttachmentAction = 'keep' | 'delete'

interface Attachment {
  Name: string
  ContentType: string
  ContentLength: number
}

interface Props {
  emailId: string
  attachments: Attachment[]
}

export function AttachmentManager({ emailId, attachments }: Props) {

  const [actions, setActions] = useState<Record<string, AttachmentAction>>(
    Object.fromEntries(attachments.map(a => [a.Name, 'delete']))
  )
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<'success' | 'error' | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  function setAction(name: string, action: AttachmentAction) {
    setActions(prev => ({ ...prev, [name]: action }))
  }

  async function handleConfirm() {
    setLoading(true)
    setResult(null)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/emails/save-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailId,
          attachmentActions: actions,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setResult('success')
    } catch (err) {
      setResult('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

const ACTION_OPTIONS: { value: AttachmentAction; label: string }[] = [
    { value: 'keep', label: 'Keep in app' },
    { value: 'delete', label: 'Delete' },
  ]

  return (
    <section>
      <h2 className="text-sm font-semibold mb-2">Attachments ({attachments.length})</h2>
      <div className="space-y-1.5 mb-3">
        {attachments.map((att) => (
          <div
            key={att.Name}
            className="flex items-center gap-3 text-sm rounded-md border px-3 py-2"
          >
            <div className="flex-1 min-w-0">
              <span className="font-medium truncate block">{att.Name}</span>
              <span className="text-muted-foreground text-xs">{att.ContentType}</span>
            </div>
            <span className="text-muted-foreground text-xs tabular-nums shrink-0">
              {Math.round(att.ContentLength / 1024)} KB
            </span>
            <div className="flex gap-1 shrink-0">
              {ACTION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setAction(att.Name, opt.value)}
                  disabled={result === 'success'}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    actions[att.Name] === opt.value
                      ? opt.value === 'delete'
                        ? 'bg-destructive/10 border-destructive/30 text-destructive font-medium'
                        : 'bg-muted border-border text-foreground font-medium'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={handleConfirm}
          disabled={loading || result === 'success'}
          className="gap-1.5"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : result === 'success' ? (
            <Check className="h-4 w-4" />
          ) : (
            <HardDrive className="h-4 w-4" />
          )}
          {result === 'success' ? 'Done' : 'Confirm'}
        </Button>
        {result === 'error' && errorMsg && (
          <span className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> {errorMsg}
          </span>
        )}
      </div>
    </section>
  )
}
