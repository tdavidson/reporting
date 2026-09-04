'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check, AlertTriangle } from 'lucide-react'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'
import { VEHICLE_KIND_LABELS, isVehicleKind, isManagementCompany } from '@/lib/vehicle-kinds'
import { EmptyState } from '@/components/ui/empty-state'

interface Row {
  id: string | null; name: string; kind: string | null
  closedThrough: string | null; lastEntryDate: string | null
  postedEntries: number; draftEntries: number; openBankRows: number
  trialBalanced: boolean; totalDebits: number; empty: boolean
}
interface Overview { vehicles: Row[]; mancoOmitted: boolean }

const kindLabel = (k: string | null) => (k && isVehicleKind(k) ? VEHICLE_KIND_LABELS[k] : 'Fund')

/** Where a row's pages live: /funds/<id>/… for a vehicle, /manco/<id>/… for a management company. */
function baseFor(r: Row): string | null {
  if (!r.id) return null
  return isManagementCompany(r.kind) ? `/manco/${r.id}` : `/funds/${r.id}`
}

export function FirmView() {
  const currency = useCurrency()
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/accounting/firm')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  }
  if (!data || data.vehicles.length === 0) {
    return <EmptyState>No entities yet. Add a fund, SPV, GP entity or management company on the Admin page.</EmptyState>
  }

  const open = data.vehicles.filter(r => !r.empty && (r.draftEntries > 0 || r.openBankRows > 0 || !r.trialBalanced))

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {open.length === 0
          ? 'Nothing waiting: no drafts, no open bank rows, every trial balance ties.'
          : `${open.length} of ${data.vehicles.length} entities have something waiting.`}
        {data.mancoOmitted && ' Management companies are not shown; that needs the management-company grant.'}
      </p>

      <div className="rounded-card border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Entity</th>
              <th className="text-left px-3 py-2 font-medium">Kind</th>
              <th className="text-left px-3 py-2 font-medium">Closed through</th>
              <th className="text-left px-3 py-2 font-medium">Last entry</th>
              <th className="text-right px-3 py-2 font-medium">Posted</th>
              <th className="text-right px-3 py-2 font-medium">Drafts</th>
              <th className="text-right px-3 py-2 font-medium">Bank open</th>
              <th className="text-right px-3 py-2 font-medium">Trial balance</th>
              <th className="text-left px-3 py-2 font-medium">Ties</th>
            </tr>
          </thead>
          <tbody>
            {data.vehicles.map(r => {
              const base = baseFor(r)
              const cell = (label: string | number, href: string, warn = false) => (
                base
                  ? <Link href={`${base}${href}`} className={warn ? 'text-warning hover:underline' : 'hover:underline'}>{label}</Link>
                  : <span className={warn ? 'text-warning' : undefined}>{label}</span>
              )
              return (
                <tr key={r.id ?? r.name} className="border-t">
                  <td className="px-3 py-2 font-medium">{base ? <Link href={`${base}/status`} className="hover:underline">{r.name}</Link> : r.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{kindLabel(r.kind)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.closedThrough ? cell(r.closedThrough, '/periods') : <span className="text-muted-foreground">Never</span>}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.lastEntryDate ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{cell(r.postedEntries, '/journal')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{cell(r.draftEntries, '/journal?status=draft', r.draftEntries > 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{cell(r.openBankRows, '/bank', r.openBankRows > 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.empty ? <span className="text-muted-foreground">—</span> : cell(formatCurrencyFull(r.totalDebits, currency), '/statements')}</td>
                  <td className="px-3 py-2">
                    {r.empty
                      ? <span className="text-muted-foreground">Empty</span>
                      : r.trialBalanced
                        ? <span className="inline-flex items-center gap-1 text-success"><Check className="h-3.5 w-3.5" />Yes</span>
                        : <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="h-3.5 w-3.5" />No</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
