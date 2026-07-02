'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** First-run setup: seed the default chart of accounts, then link to opening balances. */
export function AccountingSetup() {
  const [accountCount, setAccountCount] = useState<number | null>(null)
  const [seeding, setSeeding] = useState(false)

  const refresh = () =>
    fetch('/api/accounting/chart')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setAccountCount(Array.isArray(d) ? d.length : 0))

  useEffect(() => { refresh() }, [])

  async function seed() {
    setSeeding(true)
    await fetch('/api/accounting/chart', { method: 'POST' })
    await refresh()
    setSeeding(false)
  }

  if (accountCount === null) return null

  return (
    <div className="border rounded-lg p-4 mb-6 bg-muted/20">
      <p className="text-sm font-medium mb-1">Setup</p>
      <ol className="text-sm text-muted-foreground space-y-2">
        <li className="flex items-center gap-2">
          {accountCount > 0
            ? <><Check className="h-4 w-4 text-green-600" /> Chart of accounts seeded ({accountCount} accounts).</>
            : (
              <>
                <span>1. Seed the default chart of accounts.</span>
                <Button size="sm" variant="outline" onClick={seed} disabled={seeding}>
                  {seeding && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Seed chart
                </Button>
              </>
            )}
        </li>
        <li>
          2. <Link href="/accounting/opening-balances" className="underline underline-offset-2 hover:text-foreground">Import opening balances</Link> from a recent capital account statement.
        </li>
        <li>3. Post a period of activity, then reconcile against the admin statement.</li>
      </ol>
    </div>
  )
}
