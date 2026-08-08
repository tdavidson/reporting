'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useVehicle } from '@/components/accounting-vehicle'
import { FofValuationNote, type ValuationBasisRow } from '@/components/accounting/fof-valuation-note'
import {
  FofSoiTable, FofCommitmentTable, FofPerformanceTable,
  type SoiRow, type CommitmentSchedule, type PerformanceTable,
} from '@/components/accounting/fof-exhibit-tables'

interface Exhibits {
  asOf: string
  totalNav: number
  cash: number
  soi: SoiRow[]
  commitments: CommitmentSchedule
  performance: PerformanceTable
  valuationNote: ValuationBasisRow[]
}

/** The three quarterly exhibits, all from one load so they cannot disagree with each other. */
export function FofReportView() {
  const { group } = useVehicle()
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))
  const [groupMode, setGroupMode] = useState<'vintage' | 'strategy'>('vintage')
  const [data, setData] = useState<Exhibits | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ asOf })
      if (group) qs.set('group', group)
      const res = await fetch(`/api/accounting/fof-exhibits?${qs}`)
      setData(res.ok ? await res.json() : null)
    } finally {
      setLoading(false)
    }
  }, [asOf, group])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  }
  if (!data || data.soi.length === 0) {
    return <p className="text-sm text-muted-foreground">No fund holdings yet.</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">As of</span>
        <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}
               className="border rounded-lg px-2 py-1 text-sm" />
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant={groupMode === 'vintage' ? 'default' : 'outline'}
                  onClick={() => setGroupMode('vintage')}>By vintage</Button>
          <Button size="sm" variant={groupMode === 'strategy' ? 'default' : 'outline'}
                  onClick={() => setGroupMode('strategy')}>By strategy</Button>
        </div>
      </div>

      <Card className="rounded-card">
        <CardContent className="p-4 space-y-2">
          <h2 className="text-base font-medium">Schedule of investments — underlying funds</h2>
          <FofSoiTable rows={data.soi} groupMode={groupMode} />
        </CardContent>
      </Card>

      <Card className="rounded-card">
        <CardContent className="p-4 space-y-2">
          <h2 className="text-base font-medium">Commitments and liquidity</h2>
          <FofCommitmentTable schedule={data.commitments} />
        </CardContent>
      </Card>

      <Card className="rounded-card">
        <CardContent className="p-4 space-y-2">
          <h2 className="text-base font-medium">Underlying fund performance</h2>
          <FofPerformanceTable table={data.performance} />
        </CardContent>
      </Card>

      <Card className="rounded-card">
        <CardContent className="p-4">
          <FofValuationNote rows={data.valuationNote} />
        </CardContent>
      </Card>
    </div>
  )
}
