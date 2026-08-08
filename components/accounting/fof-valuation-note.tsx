'use client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCurrency, formatCurrency } from '@/components/currency-context'

/** Mirrors ValuationBasisRow from lib/portfolio/fof-valuation.ts. */
export interface ValuationBasisRow {
  name: string
  navAsOf: string | null
  basis: 'final' | 'preliminary' | 'estimate' | 'unreported'
  stalenessDays: number | null
  carryingValue: number
  rolledForward: boolean
}

/** Kept in step with STALE_NAV_DAYS in lib/portfolio/fof-valuation.ts. */
const STALE_DAYS = 100

/**
 * The valuation-basis disclosure: which valuation each position carries, struck when, on what
 * basis, and whether we rolled it forward. Auditors ask for this table by name, and a typed
 * version of it is stale the first time a manager restates.
 */
export function FofValuationNote({ rows }: { rows: ValuationBasisRow[] }) {
  const currency = useCurrency()
  if (rows.length === 0) return null

  return (
    <div className="space-y-2">
      <h2 className="text-base font-medium">Basis of valuation</h2>
      <p className="text-sm text-muted-foreground">
        Each position is carried at the manager&rsquo;s most recent reported net asset value,
        adjusted for capital called and distributions received between that valuation date and
        the reporting date.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fund</TableHead>
            <TableHead>NAV as of</TableHead>
            <TableHead>Basis</TableHead>
            <TableHead className="text-right">Days stale</TableHead>
            <TableHead className="text-right">Carrying value</TableHead>
            <TableHead>Adjusted</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.name}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="tabular-nums">
                {r.navAsOf ?? <span className="text-muted-foreground">No statement received</span>}
              </TableCell>
              <TableCell className="capitalize">
                {r.basis === 'unreported'
                  ? <span className="text-muted-foreground">Carried at cost</span>
                  : r.basis}
              </TableCell>
              <TableCell className={`text-right tabular-nums ${r.stalenessDays !== null && r.stalenessDays > STALE_DAYS ? 'text-warning' : ''}`}>
                {r.stalenessDays ?? '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(r.carryingValue, currency)}</TableCell>
              <TableCell className="text-xs">
                {r.rolledForward
                  ? 'Rolled forward for cash flows'
                  : <span className="text-muted-foreground">As reported</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
