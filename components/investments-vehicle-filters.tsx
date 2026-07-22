'use client'

import { Filter, CheckSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export const VEHICLE_KINDS = ['fund', 'spv', 'direct', 'associate', 'other'] as const
export const KIND_LABELS: Record<string, string> = {
  fund: 'Funds', spv: 'SPVs', direct: 'Direct deals', associate: 'GP / associate entities', other: 'Other',
}

interface Props {
  selectedKinds: Set<string>
  onToggleKind: (k: string) => void
  showEmpty: boolean
  onToggleShowEmpty: () => void
  allVehicles: string[]
  excludedVehicles: Set<string>
  onToggleVehicle: (v: string) => void
  onToggleAllVehicles: () => void
}

function CheckRow({ checked, label, onClick, muted }: { checked: boolean; label: string; onClick: () => void; muted?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 cursor-pointer hover:bg-muted/30" onClick={onClick}>
      {checked
        ? <CheckSquare className="h-4 w-4 text-primary shrink-0" />
        : <Square className="h-4 w-4 text-muted-foreground shrink-0" />}
      <span className={`text-sm truncate ${muted ? 'text-muted-foreground' : ''}`}>{label}</span>
    </div>
  )
}

export function InvestmentVehicleFilters({
  selectedKinds, onToggleKind, showEmpty, onToggleShowEmpty,
  allVehicles, excludedVehicles, onToggleVehicle, onToggleAllVehicles,
}: Props) {
  const active = selectedKinds.size < VEHICLE_KINDS.length || showEmpty || excludedVehicles.size > 0

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={active ? 'secondary' : 'outline'} size="sm" className="text-muted-foreground">
          <Filter className="h-4 w-4 mr-1" />
          Filters
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 max-h-[70vh] overflow-y-auto p-0" align="end">
        <div className="px-4 py-2 border-b bg-muted text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Vehicle type</div>
        {VEHICLE_KINDS.map(k => (
          <CheckRow key={k} checked={selectedKinds.has(k)} label={KIND_LABELS[k]} onClick={() => onToggleKind(k)} />
        ))}

        <div className="border-t">
          <CheckRow checked={showEmpty} label="Show empty vehicles (no transactions)" onClick={onToggleShowEmpty} muted />
        </div>

        {allVehicles.length > 0 && (
          <>
            <div className="px-4 py-2 border-y bg-muted text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Vehicles</span>
              <button onClick={onToggleAllVehicles} className="text-[11px] font-normal normal-case tracking-normal text-primary hover:underline">
                {excludedVehicles.size === 0 ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            {allVehicles.map(v => (
              <CheckRow key={v} checked={!excludedVehicles.has(v)} label={v} onClick={() => onToggleVehicle(v)} />
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
