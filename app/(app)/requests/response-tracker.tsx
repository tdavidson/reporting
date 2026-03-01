'use client'

import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface QuarterInfo {
  label: string
}

interface ResponseCell {
  responded: boolean
}

interface CompanyResponse {
  companyId: string
  companyName: string
  quarters: ResponseCell[]
}

interface Props {
  quarters: QuarterInfo[]
  data: CompanyResponse[]
}

export function ResponseTracker({ quarters, data }: Props) {
  if (data.length === 0) return null

  return (
    <div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Company</TableHead>
              {quarters.map((q) => (
                <TableHead key={q.label} className="text-center">{q.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.companyId}>
                <TableCell>
                  <Link
                    href={`/companies/${row.companyId}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {row.companyName}
                  </Link>
                </TableCell>
                {row.quarters.map((cell, i) => (
                  <TableCell key={quarters[i].label} className="text-center">
                    {cell.responded ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 text-xs font-medium">
                        Yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 text-xs font-medium">
                        No
                      </span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
