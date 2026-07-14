'use client'

import { useState } from 'react'
import { Loader2, ShieldCheck, PencilLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AuthShell } from '@/components/auth-shell'

/**
 * The approve/deny screen. Deliberately blunt about what is being handed over:
 * this grant lets an agent read the fund's whole portfolio and ledger, and — for
 * an admin — post journal entries and close periods. A vague "authorize app?"
 * prompt would be doing the user a disservice.
 */

interface Props {
  clientName: string
  fundName: string
  willWrite: boolean
  /** They asked for write but aren't an admin, so we're granting read. Say so. */
  downgraded: boolean
  params: {
    client_id: string
    redirect_uri: string
    code_challenge: string
    scope: string
    state: string | null
    resource: string | null
  }
}

export function ConsentForm({ clientName, fundName, willWrite, downgraded, params }: Props) {
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(approve: boolean) {
    setBusy(approve ? 'approve' : 'deny')
    setError(null)
    try {
      const res = await fetch('/api/oauth/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, approve }),
      })
      const body = await res.json()
      if (!res.ok || !body.redirect) {
        setError(body.error ?? 'Could not complete authorization.')
        setBusy(null)
        return
      }
      // Hand control back to the app that sent us here.
      window.location.href = body.redirect
    } catch {
      setError('Could not reach the server.')
      setBusy(null)
    }
  }

  return (
    <AuthShell
      wide
      footer={
        <p className="text-center text-xs text-muted-foreground">
          It can only ever see {fundName}, never another fund. You can revoke this at any time in
          Settings, and access ends automatically if you leave the fund.
        </p>
      }
    >
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Connect {clientName}?</CardTitle>
          <CardDescription>
            It is asking to act on <span className="font-medium text-foreground">{fundName}</span> as you.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* The permissions, split read vs write. The write block is the one that matters,
              so it gets its own visual weight rather than being a third bullet in a list —
              "post journal entries and close periods" is not a detail. */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <div className="flex gap-2.5">
              <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-xs font-medium">Read your fund</p>
                <p className="text-xs text-muted-foreground">
                  Deal flow and diligence, the portfolio, companies and investments, LP positions and
                  fund performance, and the ledger — chart of accounts, journal entries, capital
                  accounts and financial statements.
                </p>
              </div>
            </div>

            {willWrite ? (
              <div className="flex gap-2.5 border-t pt-3">
                <PencilLine className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Make changes</p>
                  <p className="text-xs text-muted-foreground">
                    Record investments, post journal entries, run allocations, import bank transactions,
                    and close accounting periods.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex gap-2.5 border-t pt-3">
                <PencilLine className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Read-only.</span> It cannot change anything.
                </p>
              </div>
            )}
          </div>

          {downgraded && (
            <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
              <AlertDescription className="text-amber-800 dark:text-amber-200 text-xs">
                It asked for write access, but only fund admins can grant that — so it will get read-only.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2 pt-1">
            <Button onClick={() => decide(true)} disabled={busy !== null} className="flex-1">
              {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Allow'}
            </Button>
            <Button variant="outline" onClick={() => decide(false)} disabled={busy !== null} className="flex-1">
              {busy === 'deny' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Deny'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
