'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Check, Loader2 } from 'lucide-react'
import { Section } from '@/components/settings/section'
import { GoogleDriveSection } from './google-drive-section'

export function StorageSection({
  fundId,
  fileStorageProvider,
  googleDriveConnected,
  googleDriveFolderId,
  googleDriveFolderName,
  hasGoogleCredentials,
  googleClientId,
  onChanged,
}: {
  fundId: string
  fileStorageProvider: string | null
  googleDriveConnected: boolean
  googleDriveFolderId: string | null
  googleDriveFolderName: string | null
  hasGoogleCredentials: boolean
  googleClientId: string
  onChanged: () => void
}) {
  const [selectedProvider, setSelectedProvider] = useState(fileStorageProvider || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleProviderChange = async (value: string) => {
    setSelectedProvider(value)
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileStorageProvider: value || null }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onChanged()
    }
  }

  return (
    <Section title="Storage">
      <p className="text-xs text-muted-foreground mb-4">
        All portfolio data, company details, metrics, and email content are stored in the database (Supabase/PostgreSQL). By default, email attachments are also stored in the database. Optionally, connect Google Drive to store portfolio reports and attachments externally.
      </p>

      <div className="space-y-4">
        <div>
          <Label>File storage provider</Label>
          <div className="flex items-center gap-2">
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={selectedProvider}
              onChange={(e) => handleProviderChange(e.target.value)}
              disabled={saving}
            >
              <option value="">None (database only)</option>
              <option value="google_drive">Google Drive</option>
            </select>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
            {saved && <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
          </div>
        </div>

        {selectedProvider === 'google_drive' && (
          <div className="border-t pt-4">
            <GoogleDriveSection
              fundId={fundId}
              connected={googleDriveConnected}
              folderId={googleDriveFolderId}
              folderName={googleDriveFolderName}
              hasCredentials={hasGoogleCredentials}
              onChanged={onChanged}
            />
          </div>
        )}
      </div>
    </Section>
  )
}
