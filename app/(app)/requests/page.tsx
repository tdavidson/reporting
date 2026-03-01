'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, Check, Loader2, Send } from 'lucide-react'
import { ResponseTracker } from './response-tracker'

interface Company {
  id: string
  name: string
  contactEmails: string[]
}

interface Settings {
  isAdmin: boolean
  googleDriveConnected: boolean
}

interface QuarterInfo {
  label: string
}

interface CompanyResponse {
  companyId: string
  companyName: string
  quarters: { responded: boolean }[]
}

interface SendResult {
  emails: string
  success: boolean
  error?: string
}

const DEFAULT_SUBJECT = 'Laconia - Q4 and YE 2025 Information Request'

const DEFAULT_BODY = `Hi! We are finalizing Laconia's quarterly and year-end reporting and need your help obtaining the following information:

- Q4 and YE 2025 Income Statement (Monthly and Quarterly will be great, if possible)
- YE 2025 Balance Sheet (Monthly and Quarterly will be great, if possible)
- Q4 and YE 2025 Cashflow Statement (Monthly and Quarterly will be great, if possible)
- Any financing activities that occurred during the quarter (If a new financing closed, please include the fully executed documents)
- Any other crucial materials, such as the latest board decks or key KPIs

Please provide the above information by Friday, February 20, 2026. Contact me or anyone on the Laconia team if you have any questions. Thank you,

Taylor`

function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .split('\n')
    .map(line => {
      if (line.trim().startsWith('- ')) {
        return line
      }
      return line
    })
    .join('<br>\n')
}

export default function RequestsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [trackerQuarters, setTrackerQuarters] = useState<QuarterInfo[]>([])
  const [trackerData, setTrackerData] = useState<CompanyResponse[]>([])

  const [subject, setSubject] = useState(DEFAULT_SUBJECT)
  const [bodyText, setBodyText] = useState(DEFAULT_BODY)
  const [cc, setCc] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmSend, setConfirmSend] = useState(false)

  const [testEmail, setTestEmail] = useState('')
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)

  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<{ sent: number; failed: number; details: SendResult[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [settingsRes, companiesRes, requestsRes, responsesRes] = await Promise.all([
      fetch('/api/settings'),
      fetch('/api/companies'),
      fetch('/api/requests'),
      fetch('/api/requests/responses'),
    ])

    if (settingsRes.ok) {
      const data = await settingsRes.json()
      setSettings({ isAdmin: data.isAdmin, googleDriveConnected: data.googleDriveConnected })
    }

    if (companiesRes.ok) {
      const data = await companiesRes.json()
      const withEmail = data
        .filter((c: Record<string, unknown>) => {
          const emails = c.contactEmail as string[] | null
          return emails && emails.length > 0 && c.status === 'active'
        })
        .map((c: Record<string, unknown>) => ({
          id: c.id as string,
          name: c.name as string,
          contactEmails: c.contactEmail as string[],
        }))
      setCompanies(withEmail)
    }

    if (requestsRes.ok) {
      const requests = await requestsRes.json()
      const lastSent = requests.find((r: Record<string, unknown>) => r.status === 'sent')
      if (lastSent) {
        setBodyText(lastSent.body_html as string)
        if (lastSent.subject) setSubject(lastSent.subject as string)
      }
    }

    if (responsesRes.ok) {
      const data = await responsesRes.json()
      setTrackerQuarters(data.quarters ?? [])
      setTrackerData(data.data ?? [])
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggleCompany = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === companies.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(companies.map((c) => c.id)))
    }
  }

  const handleTestSend = async () => {
    if (!testEmail.trim()) return
    setTestResult(null)
    setTestSending(true)

    const res = await fetch('/api/requests/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        body_html: plainTextToHtml(bodyText),
        body_text: bodyText,
        cc: cc.trim() || undefined,
        recipients: [{ emails: [testEmail.trim()], companyName: 'Test' }],
      }),
    })

    setTestSending(false)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setTestResult({ success: false, error: data.error || 'Failed to send' })
      return
    }

    const data = await res.json()
    setTestResult({ success: data.sent > 0 })
  }

  const handleSend = async () => {
    setError(null)
    setResults(null)
    setSending(true)

    const recipients = companies
      .filter((c) => selected.has(c.id))
      .map((c) => ({ emails: c.contactEmails, companyName: c.name }))

    const res = await fetch('/api/requests/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        body_html: plainTextToHtml(bodyText),
        body_text: bodyText,
        cc: cc.trim() || undefined,
        recipients,
      }),
    })

    setSending(false)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to send')
      return
    }

    const data = await res.json()
    setResults({ sent: data.sent, failed: data.failed, details: data.results })
  }

  if (loading) {
    return (
      <div className="p-4 md:p-8 max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Responses</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your quarterly reporting program</p>
        </div>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted rounded-lg" />)}
        </div>
      </div>
    )
  }

  if (!settings?.isAdmin) {
    return (
      <div className="p-4 md:p-8 max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Responses</h1>
          <p className="text-sm text-muted-foreground mt-1">Quarterly reporting email program</p>
        </div>

        {trackerQuarters.length > 0 && (
          <ResponseTracker quarters={trackerQuarters} data={trackerData} />
        )}

        <div className="rounded-lg border border-dashed p-12 text-center space-y-2">
          <p className="text-muted-foreground">
            Administrators can configure and send quarterly reporting request emails to portfolio companies from this page.
          </p>
          <p className="text-xs text-muted-foreground">
            Contact your fund admin to set up or manage the email program.
          </p>
        </div>
      </div>
    )
  }

  if (!settings?.googleDriveConnected) {
    return (
      <div className="p-4 md:p-8 max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Responses</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your quarterly reporting program</p>
        </div>
        <div className="rounded-lg border border-dashed p-12 text-center space-y-2">
          <p className="text-muted-foreground">Connect Google in Settings to enable sending emails.</p>
          <p className="text-xs text-muted-foreground">
            Gmail access is required for sending. You may need to reconnect if you previously connected only for Drive.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Responses</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your quarterly reporting program</p>
      </div>

      {trackerQuarters.length > 0 && (
        <ResponseTracker quarters={trackerQuarters} data={trackerData} />
      )}

      {/* Subject */}
      <div className="rounded-lg border bg-card p-5 space-y-3">
        <div>
          <Label>Subject</Label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Q4 2025 Portfolio Update Request"
          />
        </div>

        <div>
          <Label>Email body</Label>
          <textarea
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring leading-relaxed"
            rows={14}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Hi! Please send us your quarterly update..."
          />
          <p className="text-xs text-muted-foreground mt-1">
            Plain text email body. Line breaks and formatting will be preserved. Pre-populated from your last sent request.
          </p>
        </div>

        <div>
          <Label>CC</Label>
          <Input
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="cc@example.com"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Optional. CC'd on every email sent.
          </p>
        </div>
      </div>

      {/* Recipients */}
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">Recipients ({selected.size} of {companies.length})</h2>
          <button
            onClick={toggleAll}
            className="text-xs text-primary hover:underline"
          >
            {selected.size === companies.length ? 'Deselect all' : 'Select all'}
          </button>
        </div>

        {companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No companies with contact emails found. Add contact emails to your companies first.
          </p>
        ) : (
          <div className="border rounded-lg divide-y max-h-[400px] overflow-y-auto">
            {companies.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-accent/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggleCompany(c.id)}
                  className="rounded border-input"
                />
                <span className="text-sm font-medium flex-1">{c.name}</span>
                <span className="text-xs text-muted-foreground text-right">
                  {c.contactEmails.join(', ')}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Test send */}
      <div className="rounded-lg border bg-card p-5 space-y-3">
        <h2 className="text-sm font-medium">Test send</h2>
        <div className="flex items-center gap-2">
          <Input
            value={testEmail}
            onChange={(e) => { setTestEmail(e.target.value); setTestResult(null) }}
            placeholder="your-email@example.com"
            className="max-w-xs"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestSend}
            disabled={testSending || !testEmail.trim() || !subject.trim() || !bodyText.trim()}
          >
            {testSending ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Sending...</>
            ) : (
              'Send test'
            )}
          </Button>
          {testResult && (
            testResult.success ? (
              <span className="text-xs text-emerald-600 flex items-center gap-1">
                <Check className="h-3 w-3" /> Sent
              </span>
            ) : (
              <span className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {testResult.error || 'Failed'}
              </span>
            )
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Send a test email to yourself before sending to all recipients.
        </p>
      </div>

      {/* Send */}
      <div className="flex items-center gap-3">
        {!confirmSend ? (
          <Button
            onClick={() => setConfirmSend(true)}
            disabled={sending || !subject.trim() || !bodyText.trim() || selected.size === 0}
          >
            <Send className="h-4 w-4 mr-1.5" /> Send to {selected.size} recipient{selected.size !== 1 ? 's' : ''}
          </Button>
        ) : (
          <>
            <Button
              variant="destructive"
              onClick={() => { setConfirmSend(false); handleSend() }}
              disabled={sending}
            >
              {sending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Sending...</>
              ) : (
                <>Confirm — send {selected.size} email{selected.size !== 1 ? 's' : ''} now</>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmSend(false)}
              disabled={sending}
            >
              Cancel
            </Button>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 p-4">
          <p className="text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> {error}
          </p>
        </div>
      )}

      {results && (
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <h2 className="text-sm font-medium">
            Results: {results.sent} sent, {results.failed} failed
          </h2>
          <div className="border rounded-lg divide-y max-h-[300px] overflow-y-auto">
            {results.details.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm">{r.emails}</span>
                {r.success ? (
                  <span className="text-xs text-emerald-600 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Sent
                  </span>
                ) : (
                  <span className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {r.error || 'Failed'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
