'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ResponseStatus } from '@/lib/requests/response-status'

interface QuarterInfo {
  label: string
  year: number
  quarter: number
}

interface ResponseCell {
  status: ResponseStatus
}

interface CompanyResponse {
  companyId: string
  companyName: string
  quarters: ResponseCell[]
}

interface Props {
  quarters: QuarterInfo[]
  data: CompanyResponse[]
  onStatusChange?: (companyId: string, quarter: number, year: number, status: ResponseStatus) => void
}

const STATUS_CYCLE: Record<ResponseStatus, ResponseStatus> = {
  yes: 'no',
  no: 'na',
  na: 'waived',
  waived: 'yes',
}

const STATUS_STYLES: Record<ResponseStatus, string> = {
  yes: 'bg-success-subtle text-success dark:bg-success-subtle/30',
  no: 'bg-destructive-subtle text-destructive dark:bg-destructive-subtle/30',
  na: 'bg-muted text-muted-foreground',
  waived: 'bg-muted text-muted-foreground italic',
}

const STATUS_LABELS: Record<ResponseStatus, string> = {
  yes: 'Yes',
  no: 'No',
  na: 'N/A',
  waived: 'Stopped',
}

const STATUS_HINTS: Record<ResponseStatus, string> = {
  yes: 'Responded',
  no: 'No response yet — follow-up reminders include this company',
  na: 'Not expected to report',
  waived: 'Stopped chasing — follow-up reminders skip this company',
}

export function ResponseTracker({ quarters, data, onStatusChange }: Props) {
  if (data.length === 0) return null

  return (
    <div>
      <div className="rounded-lg border bg-card overflow-x-auto">
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
                {row.quarters.map((cell, i) => {
                  const q = quarters[i]
                  return (
                    <TableCell key={q.label} className="text-center">
                      <button
                        onClick={() => {
                          const next = STATUS_CYCLE[cell.status]
                          onStatusChange?.(row.companyId, q.quarter, q.year, next)
                        }}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity ${STATUS_STYLES[cell.status]}`}
                        title={`${STATUS_HINTS[cell.status]}. Click to change to ${STATUS_LABELS[STATUS_CYCLE[cell.status]]}.`}
                      >
                        {STATUS_LABELS[cell.status]}
                      </button>
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
