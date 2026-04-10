'use client'

import { useState, KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { X } from 'lucide-react'
import type { Company } from '@/lib/types/database'

type Tab = 'info' | 'contacts' | 'overview'

const STAGE_OPTIONS = ['Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Growth', 'IPO track']

interface Props {
  company?: Company
  initialName?: string
  onSuccess: (company: Company) => void
  onCancel: () => void
}

export function CompanyForm({ company, initialName, onSuccess, onCancel }: Props) {
  const isEdit = !!company
  const [tab, setTab] = useState<Tab>('info')

  const [name, setName] = useState(company?.name ?? initialName ?? '')
  const [aliases, setAliases] = useState<string[]>(company?.aliases ?? [])
  const [aliasInput, setAliasInput] = useState('')
  const [stage, setStage] = useState(company?.stage ?? '')
  const [website, setWebsite] = useState(company?.website ?? '')
  const [industries, setIndustries] = useState<string[]>(company?.industry ?? [])
  const [industryInput, setIndustryInput] = useState('')
  const [tags, setTags] = useState<string[]>(company?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [portfolioGroups, setPortfolioGroups] = useState<string[]>(company?.portfolio_group ?? [])
  const [portfolioGroupInput, setPortfolioGroupInput] = useState('')
  const [notes, setNotes] = useState(company?.notes ?? '')
  const [overview, setOverview] = useState(company?.overview ?? '')
  const [founders, setFounders] = useState(company?.founders ?? '')
  const [founderEmail, setFounderEmail] = useState('')
  const [founderMobile, setFounderMobile] = useState('')
  const [relevantEmployee, setRelevantEmployee] = useState('')
  const [whyInvested, setWhyInvested] = useState(company?.why_invested ?? '')
  const [currentUpdate, setCurrentUpdate] = useState(company?.current_update ?? '')
  const [contactEmails, setContactEmails] = useState<string[]>(company?.contact_email ?? [])
  const [contactEmailInput, setContactEmailInput] = useState('')
  const [status, setStatus] = useState(company?.status ?? 'active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addTag() { const t = tagInput.trim(); if (!t || tags.includes(t)) return; setTags(p => [...p, t]); setTagInput('') }
  function removeTag(t: string) { setTags(p => p.filter(x => x !== t)) }
  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) { if (e.key === 'Enter') { e.preventDefault(); addTag() } }

  function addIndustry() { const t = industryInput.trim(); if (!t || industries.includes(t)) return; setIndustries(p => [...p, t]); setIndustryInput('') }
  function removeIndustry(v: string) { setIndustries(p => p.filter(x => x !== v)) }
  function handleIndustryKeyDown(e: KeyboardEvent<HTMLInputElement>) { if (e.key === 'Enter') { e.preventDefault(); addIndustry() } }

  function addContactEmail() { const t = contactEmailInput.trim(); if (!t || contactEmails.includes(t)) return; setContactEmails(p => [...p, t]); setContactEmailInput('') }
  function removeContactEmail(v: string) { setContactEmails(p => p.filter(x => x !== v)) }
  function handleContactEmailKeyDown(e: KeyboardEvent<HTMLInputElement>) { if (e.key === 'Enter') { e.preventDefault(); addContactEmail() } }

  function addAlias() { const t = aliasInput.trim(); if (!t || aliases.includes(t)) return; setAliases(p => [...p, t]); setAliasInput('') }
  function removeAlias(a: string) { setAliases(p => p.filter(x => x !== a)) }
  function handleAliasKeyDown(e: KeyboardEvent<HTMLInputElement>) { if (e.key === 'Enter') { e.preventDefault(); addAlias() } }

  async function submit() {
    if (!name.trim()) { setError('Name is required.'); return }
    setError(null)
    setSaving(true)
    try {
      const url = isEdit ? `/api/companies/${company.id}` : '/api/companies'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          aliases: aliases.length > 0 ? aliases : null,
          tags: tags.length > 0 ? tags : [],
          stage: stage || null,
          website: website.trim() || null,
          industry: industries.length > 0 ? industries : null,
          notes: notes.trim() || null,
          overview: overview.trim() || null,
          founders: founders.trim() || null,
          why_invested: whyInvested.trim() || null,
          current_update: currentUpdate.trim() || null,
          contact_email: contactEmails.length > 0 ? contactEmails : null,
          portfolio_group: portfolioGroups.length > 0 ? portfolioGroups : null,
          ...(isEdit ? { status } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
      onSuccess(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'info', label: 'Info' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'overview', label: 'Overview' },
  ]

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Tab menu */}
      <div className="flex border-b border-border">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── INFO ── */}
      {tab === 'info' && (
        <div className="space-y-4">

          {/* Row 1: Name + Aliases */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="company-name">Name</Label>
              <Input id="company-name" placeholder="Acme Corp" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Aliases</Label>
              {aliases.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {aliases.map(alias => (
                    <Badge key={alias} variant="secondary" className="gap-1 pr-1 text-xs">
                      {alias}
                      <button type="button" onClick={() => removeAlias(alias)} className="rounded-full hover:bg-muted-foreground/20 p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Input placeholder="Add alias + Enter" value={aliasInput} onChange={e => setAliasInput(e.target.value)} onKeyDown={handleAliasKeyDown} onBlur={addAlias} />
            </div>
          </div>

          {/* Row 2: Stage + Status */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Stage</Label>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger>
                  <SelectValue placeholder="Select stage" />
                </SelectTrigger>
                <SelectContent>
                  {STAGE_OPTIONS.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="exited">Exited</SelectItem>
                  <SelectItem value="written-off">Written off</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 3: Tags + Industry */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tags</Label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {tags.map(tag => (
                    <Badge key={tag} variant="outline" className="gap-1 pr-1 text-xs">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} className="rounded-full hover:bg-muted-foreground/20 p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Input placeholder="Add tag + Enter" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={handleTagKeyDown} onBlur={addTag} />
            </div>
            <div className="space-y-2">
              <Label>Industry</Label>
              {industries.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {industries.map(val => (
                    <Badge key={val} variant="outline" className="gap-1 pr-1 text-xs">
                      {val}
                      <button type="button" onClick={() => removeIndustry(val)} className="rounded-full hover:bg-muted-foreground/20 p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Input placeholder="Add industry + Enter" value={industryInput} onChange={e => setIndustryInput(e.target.value)} onKeyDown={handleIndustryKeyDown} onBlur={addIndustry} />
            </div>
          </div>

          {/* Row 4: Site (full width) */}
          <div className="space-y-2">
            <Label htmlFor="website">Site</Label>
            <Input id="website" placeholder="https://acme.com" value={website} onChange={e => setWebsite(e.target.value)} />
          </div>

        </div>
      )}

      {/* ── CONTACTS ── */}
      {tab === 'contacts' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="founders">Founders</Label>
            <Input id="founders" placeholder="Jane Doe, John Smith" value={founders} onChange={e => setFounders(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="founder-email">Founder Email</Label>
            <Input id="founder-email" type="email" placeholder="founder@acme.com" value={founderEmail} onChange={e => setFounderEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="founder-mobile">Founder Mobile</Label>
            <Input id="founder-mobile" type="tel" placeholder="+55 11 99999-9999" value={founderMobile} onChange={e => setFounderMobile(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="relevant-employee">Relevant Employee</Label>
            <Input id="relevant-employee" placeholder="CFO, Head of Sales…" value={relevantEmployee} onChange={e => setRelevantEmployee(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Contact Emails</Label>
            {contactEmails.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {contactEmails.map(val => (
                  <Badge key={val} variant="outline" className="gap-1 pr-1">
                    {val}
                    <button type="button" onClick={() => removeContactEmail(val)} className="rounded-full hover:bg-muted-foreground/20 p-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <Input type="email" placeholder="Add email and press Enter" value={contactEmailInput} onChange={e => setContactEmailInput(e.target.value)} onKeyDown={handleContactEmailKeyDown} onBlur={addContactEmail} />
          </div>
        </div>
      )}

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="overview">Company Overview</Label>
            <Textarea id="overview" placeholder="Brief description of the company..." value={overview} onChange={e => setOverview(e.target.value)} rows={4} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="why-invested">Why We Invested</Label>
            <Textarea id="why-invested" placeholder="Investment thesis..." value={whyInvested} onChange={e => setWhyInvested(e.target.value)} rows={4} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="current-update">Current Business Update</Label>
            <Textarea id="current-update" placeholder="Latest update on the business..." value={currentUpdate} onChange={e => setCurrentUpdate(e.target.value)} rows={4} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" placeholder="Any notes about this company…" value={notes} onChange={e => setNotes(e.target.value)} rows={4} />
          </div>
        </div>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add company'}
        </Button>
      </div>
    </div>
  )
}
