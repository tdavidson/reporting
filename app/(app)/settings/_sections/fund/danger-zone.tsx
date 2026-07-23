'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Lock } from 'lucide-react'

export function DangerZone({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    const res = await fetch('/api/settings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    })
    setDeleting(false)
    if (res.ok) {
      setOpen(false)
      onDeleted()
    }
  }

  return (
    <div className="rounded-lg border border-destructive/30 p-5">
      <h2 className="text-sm font-medium text-destructive mb-1 flex items-center gap-1.5"><Lock className="h-3 w-3 text-destructive" />Danger zone</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Permanently delete your fund and all associated data. This cannot be undone.
      </p>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Delete all data
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all data</DialogTitle>
            <DialogDescription>
              This will permanently delete your fund, all companies, metrics, emails, and reviews. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label>
              Type <code className="text-xs bg-muted px-1 rounded">DELETE ALL DATA</code> to confirm
            </Label>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE ALL DATA"
              className="mt-1"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={confirm !== 'DELETE ALL DATA' || deleting}
              onClick={handleDelete}
            >
              {deleting ? 'Deleting...' : 'Delete everything'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
