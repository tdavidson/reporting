'use client'

import { useEffect, useState } from 'react'
import { Section } from '@/components/settings/section'

export function NotificationPreferencesSection() {
  const [level, setLevel] = useState<string>('mentions')
  const [subscribedIds, setSubscribedIds] = useState<string[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/notifications').then(r => r.json()),
      fetch('/api/companies').then(r => r.json()),
    ]).then(([prefs, companiesData]) => {
      if (prefs.level) setLevel(prefs.level)
      if (prefs.subscribedCompanyIds) setSubscribedIds(prefs.subscribedCompanyIds)
      if (Array.isArray(companiesData)) {
        setCompanies(companiesData.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)))
      }
    }).finally(() => setLoading(false))
  }, [])

  const save = async (newLevel: string, newSubscribedIds?: string[]) => {
    setSaving(true)
    const body: Record<string, unknown> = { level: newLevel }
    if (newSubscribedIds !== undefined) body.subscribedCompanyIds = newSubscribedIds
    const res = await fetch('/api/settings/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const handleLevelChange = (newLevel: string) => {
    setLevel(newLevel)
    save(newLevel)
  }

  const toggleCompany = (companyId: string) => {
    const next = subscribedIds.includes(companyId)
      ? subscribedIds.filter(id => id !== companyId)
      : [...subscribedIds, companyId]
    setSubscribedIds(next)
    save(level, next)
  }

  const options = [
    { value: 'all', label: 'All notes', description: 'Get notified for every new note' },
    { value: 'mentions', label: '@Mentions & followed companies', description: 'When someone @mentions you, plus notes on companies you follow' },
    { value: 'none', label: 'None', description: 'No email notifications for notes' },
  ]

  return (
    <Section title="Note notifications">
      {loading ? (
        <div className="h-16 bg-muted rounded animate-pulse" />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground mb-3">
            Choose when you receive email notifications about new notes.
          </p>
          {options.map(opt => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                level === opt.value ? 'border-foreground/30 bg-accent/50' : 'hover:bg-accent/30'
              }`}
            >
              <input
                type="radio"
                name="note-notification-level"
                value={opt.value}
                checked={level === opt.value}
                onChange={() => handleLevelChange(opt.value)}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">{opt.label}</span>
                <p className="text-xs text-muted-foreground">{opt.description}</p>
              </div>
            </label>
          ))}

          {level === 'mentions' && companies.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs font-medium mb-2">Follow companies</p>
              <p className="text-xs text-muted-foreground mb-2">
                Get notified for all notes on these companies, even without an @mention.
              </p>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {companies.map(c => (
                  <label key={c.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subscribedIds.includes(c.id)}
                      onChange={() => toggleCompany(c.id)}
                      className="rounded"
                    />
                    <span className="text-sm">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {saving && <p className="text-xs text-muted-foreground mt-2">Saving...</p>}
          {saved && <p className="text-xs text-green-600 mt-2">Saved</p>}
        </div>
      )}
    </Section>
  )
}
