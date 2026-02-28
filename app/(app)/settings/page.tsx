'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { AlertCircle, Check, Loader2, Plus, Trash2, Copy, FolderOpen, ChevronRight, Unlink, Shield } from 'lucide-react'

interface Sender {
  id: string
  email: string
  label: string | null
  created_at: string
}

interface Settings {
  fundId: string
  fundName: string
  postmarkInboundAddress: string
  postmarkWebhookToken: string
  hasClaudeKey: boolean
  retainResolvedReviews: boolean
  resolvedReviewsTtlDays: number | null
  senders: Sender[]
  googleDriveConnected: boolean
  googleDriveFolderId: string | null
  googleDriveFolderName: string | null
  hasGoogleCredentials: boolean
  googleClientId: string
  isAdmin: boolean
}

export default function SettingsPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings')
    if (res.ok) setSettings(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight mb-6">Settings</h1>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}
        </div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight mb-6">Settings</h1>
        <p className="text-muted-foreground">Could not load settings.</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <FundNameSection name={settings.fundName} onSaved={load} />
      <ClaudeKeySection hasKey={settings.hasClaudeKey} onSaved={load} />
      <PostmarkSection
        address={settings.postmarkInboundAddress}
        token={settings.postmarkWebhookToken}
        onSaved={load}
      />
      <GoogleDriveSection
        connected={settings.googleDriveConnected}
        folderId={settings.googleDriveFolderId}
        folderName={settings.googleDriveFolderName}
        hasCredentials={settings.hasGoogleCredentials}
        clientId={settings.googleClientId}
        onChanged={load}
      />
      <SendersSection senders={settings.senders} onChanged={load} />
      {settings.isAdmin && <WhitelistSection />}
      <TeamSection isAdmin={settings.isAdmin} />
      <DangerZone onDeleted={() => router.push('/auth')} />
    </div>
  )
}

// ──────────────────────────── Fund Name ────────────────────────────

function FundNameSection({ name, onSaved }: { name: string; onSaved: () => void }) {
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fundName: value }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  return (
    <Section title="Fund name">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Label>Name</Label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <Button onClick={handleSave} disabled={saving || value === name} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}

// ──────────────────────────── Claude Key ────────────────────────────

function ClaudeKeySection({ hasKey, onSaved }: { hasKey: boolean; onSaved: () => void }) {
  const [newKey, setNewKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'valid' | 'invalid' | 'saved'>('idle')

  const testKey = async () => {
    setTesting(true)
    setStatus('idle')
    const res = await fetch('/api/test-claude-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: newKey }),
    })
    setTesting(false)
    setStatus(res.ok ? 'valid' : 'invalid')
  }

  const saveKey = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claudeApiKey: newKey }),
    })
    setSaving(false)
    if (res.ok) {
      setStatus('saved')
      setNewKey('')
      onSaved()
    }
  }

  return (
    <Section title="Claude API key">
      <p className="text-xs text-muted-foreground mb-3">
        {hasKey
          ? 'A Claude API key is configured. Enter a new key below to replace it.'
          : 'No Claude API key configured. Add one to enable report parsing.'}
      </p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label>API key</Label>
          <Input
            type="password"
            value={newKey}
            onChange={(e) => { setNewKey(e.target.value); setStatus('idle') }}
            placeholder="sk-ant-..."
          />
        </div>
        <Button onClick={testKey} disabled={!newKey.trim() || testing} variant="outline" size="sm">
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test'}
        </Button>
        <Button onClick={saveKey} disabled={!newKey.trim() || saving} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Update'}
        </Button>
      </div>
      {status === 'valid' && (
        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
          <Check className="h-3 w-3" /> Key is valid
        </p>
      )}
      {status === 'invalid' && (
        <p className="text-xs text-destructive mt-1 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> Key is invalid
        </p>
      )}
      {status === 'saved' && (
        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
          <Check className="h-3 w-3" /> Key updated
        </p>
      )}
    </Section>
  )
}

// ──────────────────────────── Postmark ────────────────────────────

function PostmarkSection({
  address,
  token,
  onSaved,
}: {
  address: string
  token: string
  onSaved: () => void
}) {
  const [addr, setAddr] = useState(address)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const defaultBase = typeof window !== 'undefined' ? window.location.origin : ''
  const [baseUrl, setBaseUrl] = useState(defaultBase)

  const webhookUrl = `${baseUrl}/api/inbound-email?token=${token}`

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postmarkInboundAddress: addr }),
    })
    setSaving(false)
    if (res.ok) onSaved()
  }

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Section title="Postmark">
      <div className="space-y-3">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label>Inbound address</Label>
            <Input
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="abc123@inbound.postmarkapp.com"
            />
          </div>
          <Button onClick={handleSave} disabled={saving || addr === address} size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
          </Button>
        </div>

        {token && (
          <div className="space-y-2">
            <div>
              <Label>Webhook base URL</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://your-app.vercel.app"
              />
              <p className="text-xs text-muted-foreground mt-1">
                For local development, use your ngrok or tunnel URL (e.g. https://abc123.ngrok.io).
              </p>
            </div>
            <div>
              <Label>Webhook URL</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted rounded px-3 py-2 truncate block">
                  {webhookUrl}
                </code>
                <Button onClick={copyWebhookUrl} variant="outline" size="icon" className="shrink-0 h-8 w-8">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Paste this URL into Postmark&#39;s inbound webhook settings.
              </p>
            </div>
          </div>
        )}
      </div>
    </Section>
  )
}

// ──────────────────────────── Google Drive ────────────────────────────

interface DriveFolder {
  id: string
  name: string
  mimeType: string
}

function GoogleDriveSection({
  connected,
  folderId,
  folderName,
  hasCredentials,
  clientId: existingClientId,
  onChanged,
}: {
  connected: boolean
  folderId: string | null
  folderName: string | null
  hasCredentials: boolean
  clientId: string
  onChanged: () => void
}) {
  const [browsing, setBrowsing] = useState(false)
  const [folders, setFolders] = useState<DriveFolder[]>([])
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [currentParent, setCurrentParent] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string; name: string }>>([])
  const [disconnecting, setDisconnecting] = useState(false)
  const [saving, setSaving] = useState(false)

  // Credentials state
  const [editingCreds, setEditingCreds] = useState(!hasCredentials)
  const [newClientId, setNewClientId] = useState(existingClientId)
  const [newClientSecret, setNewClientSecret] = useState('')
  const [savingCreds, setSavingCreds] = useState(false)
  const [credsSaved, setCredsSaved] = useState(false)

  const saveCredentials = async () => {
    if (!newClientId.trim() || !newClientSecret.trim()) return
    setSavingCreds(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        googleClientId: newClientId.trim(),
        googleClientSecret: newClientSecret.trim(),
      }),
    })
    setSavingCreds(false)
    if (res.ok) {
      setNewClientSecret('')
      setEditingCreds(false)
      setCredsSaved(true)
      setTimeout(() => setCredsSaved(false), 2000)
      onChanged()
    }
  }

  const loadFolders = async (parentId?: string) => {
    setLoadingFolders(true)
    const url = parentId
      ? `/api/settings/drive/folders?parent=${parentId}`
      : '/api/settings/drive/folders'
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      setFolders(data.folders)
    }
    setLoadingFolders(false)
  }

  const startBrowsing = async () => {
    setBrowsing(true)
    setBreadcrumbs([])
    setCurrentParent(null)
    await loadFolders()
  }

  const navigateToFolder = async (folder: DriveFolder) => {
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }])
    setCurrentParent(folder.id)
    await loadFolders(folder.id)
  }

  const navigateToBreadcrumb = async (index: number) => {
    if (index < 0) {
      setBreadcrumbs([])
      setCurrentParent(null)
      await loadFolders()
    } else {
      const crumb = breadcrumbs[index]
      setBreadcrumbs(prev => prev.slice(0, index + 1))
      setCurrentParent(crumb.id)
      await loadFolders(crumb.id)
    }
  }

  const selectCurrentFolder = async () => {
    if (!currentParent || breadcrumbs.length === 0) return
    setSaving(true)
    const lastCrumb = breadcrumbs[breadcrumbs.length - 1]
    const res = await fetch('/api/settings/drive', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder_id: lastCrumb.id,
        folder_name: lastCrumb.name,
      }),
    })
    setSaving(false)
    if (res.ok) {
      setBrowsing(false)
      onChanged()
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    const res = await fetch('/api/settings/drive', { method: 'DELETE' })
    setDisconnecting(false)
    if (res.ok) {
      setBrowsing(false)
      onChanged()
    }
  }

  if (!connected) {
    return (
      <Section title="Google Drive">
        <p className="text-xs text-muted-foreground mb-3">
          Connect Google Drive to automatically save email attachments and reports to a folder.
        </p>

        {/* Credentials setup */}
        {(editingCreds || !hasCredentials) ? (
          <div className="space-y-3 mb-4">
            <p className="text-xs font-medium">Google OAuth credentials</p>
            <div className="space-y-2">
              <div>
                <Label>Client ID</Label>
                <Input
                  value={newClientId}
                  onChange={(e) => setNewClientId(e.target.value)}
                  placeholder="123456789.apps.googleusercontent.com"
                />
              </div>
              <div>
                <Label>Client secret</Label>
                <Input
                  type="password"
                  value={newClientSecret}
                  onChange={(e) => setNewClientSecret(e.target.value)}
                  placeholder="GOCSPX-..."
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Create credentials at{' '}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="underline">
                  Google Cloud Console
                </a>
                . Add <code className="text-[11px] bg-muted px-1 rounded">{typeof window !== 'undefined' ? window.location.origin : ''}/api/auth/google/callback</code> as an authorized redirect URI.
              </p>
              <Button size="sm" onClick={saveCredentials} disabled={savingCreds || !newClientId.trim() || !newClientSecret.trim()}>
                {savingCreds ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save credentials'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-4">
            <p className="text-xs text-muted-foreground flex-1">
              Google credentials configured.
              {credsSaved && <span className="text-emerald-600 ml-1">Saved!</span>}
            </p>
            <Button size="sm" variant="outline" onClick={() => setEditingCreds(true)} className="text-xs h-7">
              Update credentials
            </Button>
          </div>
        )}

        {hasCredentials && (
          <Button size="sm" onClick={() => { window.location.href = '/api/auth/google' }}>
            Connect Google Drive
          </Button>
        )}
      </Section>
    )
  }

  return (
    <Section title="Google Drive">
      <p className="text-xs text-muted-foreground mb-3">
        Google Drive is connected. Attachments from processed emails will be saved automatically.
      </p>

      {/* Credentials management (collapsed by default when connected) */}
      {editingCreds ? (
        <div className="space-y-3 mb-4">
          <p className="text-xs font-medium">Google OAuth credentials</p>
          <div className="space-y-2">
            <div>
              <Label>Client ID</Label>
              <Input
                value={newClientId}
                onChange={(e) => setNewClientId(e.target.value)}
                placeholder="123456789.apps.googleusercontent.com"
              />
            </div>
            <div>
              <Label>Client secret</Label>
              <Input
                type="password"
                value={newClientSecret}
                onChange={(e) => setNewClientSecret(e.target.value)}
                placeholder="GOCSPX-..."
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveCredentials} disabled={savingCreds || !newClientId.trim() || !newClientSecret.trim()}>
                {savingCreds ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save credentials'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditingCreds(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-4">
          <p className="text-xs text-muted-foreground flex-1">
            Google credentials configured.
            {credsSaved && <span className="text-emerald-600 ml-1">Saved!</span>}
          </p>
          <Button size="sm" variant="outline" onClick={() => setEditingCreds(true)} className="text-xs h-7">
            Update credentials
          </Button>
        </div>
      )}

      {folderName && (
        <div className="flex items-center gap-2 mb-3 text-sm">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span>Saving to: <span className="font-medium">{folderName}</span></span>
        </div>
      )}

      {!browsing ? (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={startBrowsing}>
            {folderId ? 'Change folder' : 'Select folder'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-destructive hover:text-destructive"
          >
            {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5 mr-1" />}
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg p-3 space-y-3">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
            <button
              onClick={() => navigateToBreadcrumb(-1)}
              className="hover:text-foreground"
            >
              My Drive
            </button>
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3" />
                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  className="hover:text-foreground"
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>

          {/* Folder list */}
          {loadingFolders ? (
            <div className="flex items-center gap-2 py-4 justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading folders...
            </div>
          ) : folders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No subfolders</p>
          ) : (
            <div className="border rounded divide-y max-h-48 overflow-auto">
              {folders.map(folder => (
                <button
                  key={folder.id}
                  onClick={() => navigateToFolder(folder)}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                >
                  <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">{folder.name}</span>
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setBrowsing(false)}>
              Cancel
            </Button>
            {currentParent && breadcrumbs.length > 0 && (
              <Button size="sm" onClick={selectCurrentFolder} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Select &quot;{breadcrumbs[breadcrumbs.length - 1].name}&quot;
              </Button>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}

// ──────────────────────────── Senders ────────────────────────────

function SendersSection({
  senders,
  onChanged,
}: {
  senders: Sender[]
  onChanged: () => void
}) {
  const [email, setEmail] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleAdd = async () => {
    if (!email.trim()) return
    setAdding(true)
    const res = await fetch('/api/settings/senders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, label }),
    })
    setAdding(false)
    if (res.ok) {
      setEmail('')
      setLabel('')
      onChanged()
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const res = await fetch(`/api/settings/senders/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (res.ok) onChanged()
  }

  return (
    <Section title="Authorized senders">
      <p className="text-xs text-muted-foreground mb-3">
        Only emails from these addresses will be processed.
      </p>

      {senders.length > 0 && (
        <div className="border rounded-lg divide-y mb-3">
          {senders.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-3 py-2">
              <div>
                <span className="text-sm">{s.email}</span>
                {s.label && (
                  <span className="text-xs text-muted-foreground ml-2">({s.label})</span>
                )}
              </div>
              <button
                onClick={() => handleDelete(s.id)}
                disabled={deletingId === s.id}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label>Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="founder@company.com"
          />
        </div>
        <div className="w-32">
          <Label>Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="optional"
          />
        </div>
        <Button onClick={handleAdd} disabled={adding || !email.trim()} size="sm">
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </Section>
  )
}

// ──────────────────────────── Signup Whitelist ────────────────────────────

interface WhitelistEntry {
  id: string
  email_pattern: string
  created_at: string
}

function WhitelistSection() {
  const [entries, setEntries] = useState<WhitelistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [pattern, setPattern] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/whitelist')
    if (res.ok) {
      const data = await res.json()
      setEntries(data.entries)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!pattern.trim()) return
    setAdding(true)
    setError(null)
    const res = await fetch('/api/settings/whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailPattern: pattern }),
    })
    setAdding(false)
    if (res.ok) {
      setPattern('')
      load()
    } else {
      const data = await res.json()
      setError(data.error)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const res = await fetch(`/api/settings/whitelist/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (res.ok) load()
  }

  return (
    <Section title="Signup whitelist">
      <p className="text-xs text-muted-foreground mb-3">
        Only these emails or domains can create accounts. Use <code className="text-[11px] bg-muted px-1 rounded">*@domain.com</code> to allow an entire domain.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...
        </div>
      ) : (
        <>
          {entries.length > 0 && (
            <div className="border rounded-lg divide-y mb-3">
              {entries.map((e) => (
                <div key={e.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm font-mono">{e.email_pattern}</span>
                  <button
                    onClick={() => handleDelete(e.id)}
                    disabled={deletingId === e.id}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label>Email or domain pattern</Label>
              <Input
                value={pattern}
                onChange={(e) => { setPattern(e.target.value); setError(null) }}
                placeholder="user@example.com or *@example.com"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
              />
            </div>
            <Button onClick={handleAdd} disabled={adding || !pattern.trim()} size="sm">
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {error && (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {error}
            </p>
          )}
        </>
      )}
    </Section>
  )
}

// ──────────────────────────── Team ────────────────────────────

interface Member {
  id: string
  userId: string
  email: string
  role: string
  createdAt: string
}

interface JoinRequest {
  id: string
  email: string
  createdAt: string
}

function TeamSection({ isAdmin }: { isAdmin: boolean }) {
  const [members, setMembers] = useState<Member[]>([])
  const [pendingRequests, setPendingRequests] = useState<JoinRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/members')
    if (res.ok) {
      const data = await res.json()
      setMembers(data.members)
      setPendingRequests(data.pendingRequests)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleRequest = async (requestId: string, action: 'approve' | 'reject') => {
    setProcessingId(requestId)
    const res = await fetch(`/api/settings/members/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setProcessingId(null)
    if (res.ok) load()
  }

  return (
    <Section title="Team">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...
        </div>
      ) : (
        <div className="space-y-4">
          {/* Members list */}
          <div className="border rounded-lg divide-y">
            {members.map(m => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{m.email}</span>
                  {m.role === 'admin' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-primary/10 text-primary rounded-full px-2 py-0.5">
                      <Shield className="h-2.5 w-2.5" />
                      Admin
                    </span>
                  )}
                </div>
                {m.role !== 'admin' && (
                  <span className="text-xs text-muted-foreground">Member</span>
                )}
              </div>
            ))}
          </div>

          {/* Pending requests (admin only) */}
          {isAdmin && pendingRequests.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-2">Pending requests</p>
              <div className="border rounded-lg divide-y">
                {pendingRequests.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <span className="text-sm">{r.email}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRequest(r.id, 'reject')}
                        disabled={processingId === r.id}
                        className="h-7 text-xs"
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleRequest(r.id, 'approve')}
                        disabled={processingId === r.id}
                        className="h-7 text-xs"
                      >
                        {processingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Approve'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

// ──────────────────────────── Danger Zone ────────────────────────────

function DangerZone({ onDeleted }: { onDeleted: () => void }) {
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
      <h2 className="text-sm font-medium text-destructive mb-1">Danger zone</h2>
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

// ──────────────────────────── Shared ────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <h2 className="text-sm font-medium mb-3">{title}</h2>
      {children}
    </div>
  )
}
