'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ExternalLink, Plus, Trash2, Link as LinkIcon, Loader2, Pencil } from 'lucide-react'
import { ComplianceNav } from '../compliance-nav'

interface ComplianceItem {
  id: string
  short_name: string
}

interface ComplianceLink {
  id: string
  compliance_item_id: string | null
  title: string
  description: string | null
  url: string
}

export default function ComplianceLinksPage() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ComplianceItem[]>([])
  const [links, setLinks] = useState<ComplianceLink[]>([])
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [itemId, setItemId] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editItemId, setEditItemId] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/compliance').then(r => r.json()),
      fetch('/api/compliance/links').then(r => r.json()),
    ])
      .then(([d, linksData]) => {
        setItems((d.items ?? []).map((i: any) => ({ id: i.id, short_name: i.short_name })))
        setLinks(Array.isArray(linksData) ? linksData : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !url.trim()) return
    setSaving(true)
    const res = await fetch('/api/compliance/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || undefined,
        url: url.trim(),
        compliance_item_id: itemId || undefined,
      }),
    })
    if (res.ok) {
      const newLink = await res.json()
      setLinks(prev => [...prev, newLink])
    }
    setTitle('')
    setDescription('')
    setUrl('')
    setItemId('')
    setShowForm(false)
    setSaving(false)
  }

  function startEdit(link: ComplianceLink) {
    setEditingId(link.id)
    setEditTitle(link.title)
    setEditDescription(link.description ?? '')
    setEditUrl(link.url)
    setEditItemId(link.compliance_item_id ?? '')
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function handleEditSave(id: string) {
    if (!editTitle.trim() || !editUrl.trim()) return
    setEditSaving(true)
    const res = await fetch('/api/compliance/links', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
        url: editUrl.trim(),
        compliance_item_id: editItemId || null,
      }),
    })
    if (res.ok) {
      const updated = await res.json()
      setLinks(prev => prev.map(l => l.id === id ? updated : l))
    }
    setEditingId(null)
    setEditSaving(false)
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/compliance/links?id=${id}`, { method: 'DELETE' })
    if (res.ok) setLinks(prev => prev.filter(l => l.id !== id))
  }

  if (loading) {
    return (
      <div className="p-4 md:py-8 md:pl-8 md:pr-4 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 max-w-3xl">
      <div className="mb-6 space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Compliance</h1>
          <Button size="sm" variant="outline" className="text-muted-foreground" onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4 mr-1" />
            Add link
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Save links to filing portals, regulatory accounts, and reference documents.
        </p>
        <div className="pt-2">
          <ComplianceNav active="links" />
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-card border p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Title</label>
              <input
                type="text"
                placeholder="e.g. IARD Account"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm rounded border bg-background"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">URL</label>
              <input
                type="url"
                placeholder="https://..."
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm rounded border bg-background"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
              <input
                type="text"
                placeholder="Optional"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm rounded border bg-background"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Related compliance item</label>
              <select
                value={itemId}
                onChange={e => setItemId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm rounded border bg-background"
              >
                <option value="">None</option>
                {items.map(item => (
                  <option key={item.id} value={item.id}>{item.short_name}</option>
                ))}
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={saving || !title.trim() || !url.trim()}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {links.length > 0 ? (
        <div className="rounded-lg border divide-y">
          {links.map(link =>
            editingId === link.id ? (
              <div key={link.id} className="px-4 py-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className="w-full px-2 py-1 text-sm rounded border bg-background"
                    placeholder="Title"
                  />
                  <input
                    type="url"
                    value={editUrl}
                    onChange={e => setEditUrl(e.target.value)}
                    className="w-full px-2 py-1 text-sm rounded border bg-background"
                    placeholder="https://..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                    className="w-full px-2 py-1 text-sm rounded border bg-background"
                    placeholder="Description (optional)"
                  />
                  <select
                    value={editItemId}
                    onChange={e => setEditItemId(e.target.value)}
                    className="w-full px-2 py-1 text-sm rounded border bg-background"
                  >
                    <option value="">None</option>
                    {items.map(item => (
                      <option key={item.id} value={item.id}>{item.short_name}</option>
                    ))}
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={editSaving || !editTitle.trim() || !editUrl.trim()}
                    onClick={() => handleEditSave(link.id)}
                  >
                    {editSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                  <Button size="sm" variant="outline" className="text-muted-foreground" onClick={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div key={link.id} className="flex items-center gap-3 px-4 py-3 text-sm group">
                <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline"
                  >
                    {link.title}
                  </a>
                  {link.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{link.description}</p>
                  )}
                </div>
                {link.compliance_item_id && link.compliance_item_id !== 'other' && (
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded shrink-0">
                    {items.find(i => i.id === link.compliance_item_id)?.short_name ?? link.compliance_item_id}
                  </span>
                )}
                <button
                  onClick={() => startEdit(link)}
                  className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(link.id)}
                  className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )
          )}
        </div>
      ) : !showForm ? (
        <div className="rounded-card border p-8 text-center">
          <LinkIcon className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No links saved yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Add links to filing portals, accounts, or reference documents.</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowForm(true)}>
            <Plus className="h-3 w-3 mr-1" />
            Add your first link
          </Button>
        </div>
      ) : null}
    </div>
  )
}
