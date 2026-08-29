'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/confirm-dialog'

type Attachment = { Name: string; ContentType: string; ContentLength: number; StoragePath?: string; AttachmentId?: string }

export function AttachmentList({ emailId, attachments }: { emailId: string; attachments: Attachment[] }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null)

  async function remove(index: number, name: string) {
    const displayName = name.length > 100 ? `${name.slice(0, 48)}…${name.slice(-48)}` : name
    const ok = await confirm({
      title: 'Delete attachment',
      description: `Delete “${displayName}” from this email? It will no longer be included when the email is reprocessed. Copies previously exported to Drive or diligence are not removed.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    setDeletingIndex(index)
    try {
      const key = attachments[index].AttachmentId ?? attachments[index].StoragePath ?? ''
      const query = key ? `?key=${encodeURIComponent(key)}` : ''
      const res = await fetch(`/api/emails/${emailId}/attachment/${index}${query}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed to delete attachment')
      toast.success('Attachment deleted')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete attachment')
    } finally {
      setDeletingIndex(null)
    }
  }

  return (
    <section>
      <h2 className="text-base font-semibold mb-2">Attachments ({attachments.length})</h2>
      <div className="space-y-1.5">
        {attachments.map((att, index) => (
          <div key={`${att.Name}-${index}`} className="flex items-center gap-3 text-sm rounded-md border px-3 py-2">
            <span className="font-medium min-w-0 truncate">{att.Name}</span>
            <span className="text-muted-foreground text-xs">{att.ContentType}</span>
            <span className="ml-auto text-muted-foreground text-xs tabular-nums shrink-0">{Math.round(att.ContentLength / 1024)} KB</span>
            <Button asChild variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground">
              <a href={`/api/emails/${emailId}/attachment/${index}`} title="Download attachment"><Download className="h-3.5 w-3.5" /></a>
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => remove(index, att.Name)} disabled={deletingIndex !== null} title="Delete attachment">
              {deletingIndex === index ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
