'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2,
  XCircle,
  Circle,
  RefreshCw,
  Settings,
  Loader2,
} from 'lucide-react'

interface SetupStatus {
  infrastructure: {
    supabaseUrl: boolean
    supabaseAnonKey: boolean
    serviceRoleKey: boolean
    encryptionKey: boolean
    appUrl: boolean
    setupPageEnabled: boolean
  }
  database: {
    connected: boolean
    coreTablesExist: boolean
    coreTableCount: number
    expectedTableCount: number
  } | null
  authentication: { hasUser: boolean } | null
  fund: { hasFund: boolean } | null
  ai: { hasProvider: boolean } | null
  inboundEmail: { providerConfigured: boolean; keyConfigured: boolean } | null
  outboundEmail: { providerConfigured: boolean; keyConfigured: boolean } | null
  fileStorage: { connected: boolean } | null
  senders: { count: number } | null
}

interface CheckItem {
  label: string
  passed: boolean
  required: boolean
  helpUrl?: string
  helpLabel?: string
}

interface Section {
  title: string
  checks: CheckItem[]
}

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/setup')
      if (!res.ok) throw new Error('Failed to fetch setup status')
      const data = await res.json()
      setStatus(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  function buildSections(s: SetupStatus): Section[] {
    const sections: Section[] = []

    sections.push({
      title: 'Infrastructure',
      checks: [
        { label: 'NEXT_PUBLIC_SUPABASE_URL', passed: s.infrastructure.supabaseUrl, required: true, helpLabel: 'Supabase docs', helpUrl: 'https://supabase.com/docs/guides/getting-started' },
        { label: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', passed: s.infrastructure.supabaseAnonKey, required: true, helpLabel: 'Supabase docs', helpUrl: 'https://supabase.com/docs/guides/getting-started' },
        { label: 'SUPABASE_SERVICE_ROLE_KEY', passed: s.infrastructure.serviceRoleKey, required: true, helpLabel: 'Supabase docs', helpUrl: 'https://supabase.com/docs/guides/getting-started' },
        { label: 'ENCRYPTION_KEY', passed: s.infrastructure.encryptionKey, required: true },
        { label: 'NEXT_PUBLIC_APP_URL', passed: s.infrastructure.appUrl, required: true },
        { label: 'ENABLE_SETUP_PAGE', passed: s.infrastructure.setupPageEnabled, required: false },
      ],
    })

    if (s.database) {
      sections.push({
        title: 'Database',
        checks: [
          { label: 'Database connection', passed: s.database.connected, required: true },
          {
            label: `Core tables (${s.database.coreTableCount}/${s.database.expectedTableCount})`,
            passed: s.database.coreTablesExist,
            required: true,
          },
        ],
      })
    }

    if (s.authentication) {
      sections.push({
        title: 'Authentication',
        checks: [
          { label: 'At least one user created', passed: s.authentication.hasUser, required: true, helpLabel: 'Sign up', helpUrl: '/auth' },
        ],
      })
    }

    if (s.fund) {
      sections.push({
        title: 'Fund',
        checks: [
          { label: 'Fund created', passed: s.fund.hasFund, required: true, helpLabel: 'Onboarding', helpUrl: '/onboarding' },
        ],
      })
    }

    if (s.ai) {
      sections.push({
        title: 'AI',
        checks: [
          { label: 'AI provider key configured', passed: s.ai.hasProvider, required: true, helpLabel: 'Settings', helpUrl: '/settings' },
        ],
      })
    }

    if (s.inboundEmail) {
      sections.push({
        title: 'Inbound Email',
        checks: [
          { label: 'Inbound email provider set', passed: s.inboundEmail.providerConfigured, required: false, helpLabel: 'Settings', helpUrl: '/settings' },
          { label: 'Inbound email key configured', passed: s.inboundEmail.keyConfigured, required: false, helpLabel: 'Settings', helpUrl: '/settings' },
        ],
      })
    }

    if (s.outboundEmail) {
      sections.push({
        title: 'Outbound Email',
        checks: [
          { label: 'Outbound email provider set', passed: s.outboundEmail.providerConfigured, required: false, helpLabel: 'Settings', helpUrl: '/settings' },
          { label: 'Outbound email key configured', passed: s.outboundEmail.keyConfigured, required: false, helpLabel: 'Settings', helpUrl: '/settings' },
        ],
      })
    }

    if (s.fileStorage) {
      sections.push({
        title: 'File Storage',
        checks: [
          { label: 'Google Drive or Dropbox connected', passed: s.fileStorage.connected, required: false, helpLabel: 'Settings', helpUrl: '/settings' },
        ],
      })
    }

    if (s.senders) {
      sections.push({
        title: 'Authorized Senders',
        checks: [
          { label: `At least one sender (${s.senders.count} configured)`, passed: s.senders.count > 0, required: false, helpLabel: 'Settings', helpUrl: '/settings' },
        ],
      })
    }

    return sections
  }

  const sections = status ? buildSections(status) : []
  const requiredChecks = sections.flatMap((s) => s.checks.filter((c) => c.required))
  const passedRequired = requiredChecks.filter((c) => c.passed).length
  const allRequiredPassed = requiredChecks.length > 0 && passedRequired === requiredChecks.length

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-6 w-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">Setup Checklist</h1>
          </div>
          <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && !status && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {status && (
          <>
            <div
              className={`rounded-lg border p-4 text-sm font-medium ${
                allRequiredPassed
                  ? 'border-green-500/50 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                  : 'border-amber-500/50 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
              }`}
            >
              {allRequiredPassed
                ? 'All required checks passed!'
                : `${passedRequired} of ${requiredChecks.length} required checks passing`}
            </div>

            {sections.map((section) => (
              <div key={section.title} className="rounded-lg border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {section.title}
                </h2>
                <ul className="space-y-2">
                  {section.checks.map((check) => (
                    <li key={check.label} className="flex items-center gap-3 text-sm">
                      {check.passed ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                      ) : check.required ? (
                        <XCircle className="h-5 w-5 shrink-0 text-red-500" />
                      ) : (
                        <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
                      )}
                      <span className={check.passed ? '' : check.required ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}>
                        {check.label}
                      </span>
                      {!check.passed && check.helpUrl && (
                        <a
                          href={check.helpUrl}
                          target={check.helpUrl.startsWith('http') ? '_blank' : undefined}
                          rel={check.helpUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                          className="ml-auto text-xs text-primary underline underline-offset-4 hover:text-primary/80"
                        >
                          {check.helpLabel}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <p className="text-xs text-muted-foreground text-center">
              Once setup is complete, set <code className="rounded bg-muted px-1 py-0.5">ENABLE_SETUP_PAGE=false</code> or remove it to disable this page.
            </p>

            <p className="text-xs text-muted-foreground text-center">v0.9.1</p>
          </>
        )}
      </div>
    </div>
  )
}
