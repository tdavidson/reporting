'use client'

import { useState, useEffect } from 'react'
import { BarChart2, Table2 } from 'lucide-react'
import { CompanyCharts } from './company-charts'
import { DashboardTable } from '@/app/(app)/dashboard/dashboard-table'
import type { Metric } from '@/lib/types/database'

interface Props {
  companyId: string
  companyName: string
  metrics: Metric[]
  isAdmin?: boolean
  allMetrics?: { id: string; name: string; is_active: boolean; display_order: number }[]
}

function storageKey(companyId: string) {
  return `company-metrics-view-${companyId}`
}

export function CompanyMetricsView({ companyId, companyName, metrics, isAdmin, allMetrics }: Props) {
  const [view, setView] = useState<'charts' | 'table'>('charts')
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey(companyId))
      if (saved === 'table' || saved === 'charts') setView(saved)
    } catch {}
    setHydrated(true)
  }, [companyId])

  function switchView(next: 'charts' | 'table') {
    setView(next)
    try { localStorage.setItem(storageKey(companyId), next) } catch {}
  }

  return (
    <div>
      {hydrated && (
        <div className="flex justify-end">
          <div className="flex items-center gap-0.5 border border-border rounded-md p-0.5 bg-muted/40 w-fit">
            <button
              onClick={() => switchView('charts')}
              className={`flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium transition-colors ${
                view === 'charts'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <BarChart2 className="h-3.5 w-3.5" /> Charts
            </button>
            <button
              onClick={() => switchView('table')}
              className={`flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium transition-colors ${
                view === 'table'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Table2 className="h-3.5 w-3.5" /> Table
            </button>
          </div>
        </div>
      )}

      <div className={hydrated ? 'mt-4' : ''}>
        {!hydrated || view === 'charts' ? (
          <CompanyCharts
            companyId={companyId}
            companyName={companyName}
            metrics={metrics}
            isAdmin={isAdmin}
            allMetrics={allMetrics}
          />
        ) : (
          <DashboardTable
            companyIds={[companyId]}
            grouped={null}
            hideCompanyColumn
          />
        )}
      </div>
    </div>
  )
}
