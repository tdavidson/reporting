'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Loader2, ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog'
import {
  InvestmentTransactionForm, LedgerSaveNote, type LedgerResult,
} from '@/components/investment-transaction-form'
import type { InvestmentTransaction } from '@/lib/types/database'
import type { CompanyInvestmentSummary } from '@/lib/types/investments'

interface CompanyOption { id: string; name: string; status: string | null; portfolioGroup: string[] | null }

/** What the form needs to know about the company before it can be shown. */
interface CompanyBooks { transactions: InvestmentTransaction[]; summary: CompanyInvestmentSummary | null; lotMethod: string }

/**
 * Record an investment transaction from /start, without leaving it.
 *
 * The form is the company page's — the same component, every rule intact (see
 * investment-transaction-form.tsx for why there is exactly one). The only thing the landing page
 * has to add is the question the company page already knows the answer to: which company. So
 * the modal is that question, then the form, then a confirmation with the way to the company.
 *
 * The confirmation is a state of the modal rather than a redirect because the user started here
 * on purpose. Someone recording three checks from a closing doesn't want to be sent to the first
 * company's page after the first one; "Add another" keeps them where they were.
 */
export function AddInvestmentButton() {
  const [open, setOpen] = useState(false)
  const [companies, setCompanies] = useState<CompanyOption[] | null>(null)
  const [companyId, setCompanyId] = useState('')
  const [books, setBooks] = useState<CompanyBooks | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ company: CompanyOption; ledger: LedgerResult | null } | null>(null)

  // The company list, fetched once per open. Cheap, and stale-proof: a company added from the
  // button next to this one shows up the next time the modal opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch('/api/companies')
      .then(async r => {
        if (!r.ok) throw new Error()
        const list = (await r.json()) as CompanyOption[]
        if (!cancelled) setCompanies(list.map(c => ({ id: c.id, name: c.name, status: c.status, portfolioGroup: c.portfolioGroup })))
      })
      .catch(() => { if (!cancelled) setLoadErr('Could not load companies') })
    return () => { cancelled = true }
  }, [open])

  // The picked company's existing rows and summary: the form seeds round names, conversion
  // sources and FX from them, exactly as it does on the company page.
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/companies/${companyId}/investments`)
      .then(async r => {
        if (!r.ok) throw new Error()
        const d = await r.json()
        if (!cancelled) setBooks({ transactions: d.transactions ?? [], summary: d.summary ?? null, lotMethod: d.lotMethod ?? 'fifo' })
      })
      .catch(() => { if (!cancelled) setLoadErr('Could not load this company’s investments') })
    return () => { cancelled = true }
  }, [companyId])

  function reset() {
    setCompanyId(''); setBooks(null); setLoadErr(null); setSaved(null)
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) { reset(); setCompanies(null) }
  }

  const company = companies?.find(c => c.id === companyId) ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8 py-2 text-muted-foreground hover:text-foreground">
          <Plus className="h-3.5 w-3.5" />Add investment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        {saved ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Check className="h-4 w-4 text-success" />Saved to {saved.company.name}</DialogTitle>
              <DialogDescription>The transaction is on the company&rsquo;s record.</DialogDescription>
            </DialogHeader>
            <LedgerSaveNote ledger={saved.ledger} onDismiss={() => setSaved(s => s && { ...s, ledger: null })} />
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { reset() }}>Add another</Button>
              <Button asChild>
                <Link href={`/companies/${saved.company.id}`}>
                  Open {saved.company.name}<ArrowRight className="h-4 w-4 ml-1.5" />
                </Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add investment</DialogTitle>
              <DialogDescription>Pick the company, then record the transaction.</DialogDescription>
            </DialogHeader>

            <div>
              <Label>Company</Label>
              {/* A native select, like the form's own instrument picker: it is the one control
                  here that must work on a phone keyboard without a component to search it. */}
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={companyId}
                onChange={e => { setBooks(null); setLoadErr(null); setCompanyId(e.target.value) }}
                disabled={!companies}
                autoFocus
              >
                <option value="">{companies ? 'Select a company…' : 'Loading companies…'}</option>
                {companies?.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.status === 'exited' ? ' (exited)' : ''}</option>
                ))}
              </select>
              {companies && companies.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">No companies yet. Add a company first.</p>
              )}
              {loadErr && <p className="mt-1 text-sm text-destructive">{loadErr}</p>}
            </div>

            {company && !books && !loadErr && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />Loading {company.name}&rsquo;s investments…
              </div>
            )}

            {company && books && (
              <div className="border-t pt-4">
                {/* Keyed on the company so switching companies mid-entry starts a fresh form
                    rather than carrying one company's numbers to another. */}
                <InvestmentTransactionForm
                  key={company.id}
                  companyId={company.id}
                  editing={null}
                  transactions={books.transactions}
                  summary={books.summary}
                  lotMethod={books.lotMethod}
                  portfolioGroups={company.portfolioGroup ?? []}
                  onSaved={s => setSaved({ company, ledger: s.ledger ?? null })}
                  onCancel={() => onOpenChange(false)}
                />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
