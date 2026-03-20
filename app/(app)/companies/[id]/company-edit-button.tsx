'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { CompanyForm } from '@/components/company-form'
import type { Company } from '@/lib/types/database'

export function CompanyEditButton({ company }: { company: Company }) {
  const [open, setOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    if (deleteConfirm !== company.name) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/companies/${company.id}`, { method: 'DELETE' })
      if (res.ok) {
        setDeleteOpen(false)
        router.push('/dashboard')
        router.refresh()
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      {/* Edit button */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Company</DialogTitle>
          </DialogHeader>
          <CompanyForm
            company={company}
            onSuccess={() => {
              setOpen(false)
              router.refresh()
            }}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete button */}
      <Dialog open={deleteOpen} onOpenChange={v => { setDeleteOpen(v); if (!v) setDeleteConfirm('') }}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Company</DialogTitle>
            <DialogDescription>
              This will permanently remove <strong>{company.name}</strong> and all its data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-sm text-muted-foreground">
              Type <strong>{company.name}</strong> to confirm:
            </p>
            <Input
              placeholder={company.name}
              value={deleteConfirm}
              onChange={e => setDeleteConfirm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleDelete()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteConfirm('') }} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || deleteConfirm !== company.name}
            >
              {deleting ? 'Deleting...' : 'Delete Company'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
