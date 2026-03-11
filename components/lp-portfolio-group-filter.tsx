'use client'

import { Filter, CheckSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface Props {
  allGroups: string[]
  excludedGroups: Set<string>
  onToggle: (group: string) => void
  onToggleAll: () => void
}

export function PortfolioGroupFilter({ allGroups, excludedGroups, onToggle, onToggleAll }: Props) {
  const allIncluded = excludedGroups.size === 0
  const hasExclusions = excludedGroups.size > 0

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="no-print">
          <Filter className="h-4 w-4 mr-1" />
          Filters
          {hasExclusions && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({allGroups.length - excludedGroups.size}/{allGroups.length})
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-[60vh] overflow-y-auto p-0" align="start">
        <div
          className="flex items-center gap-3 px-4 py-2 border-b bg-muted cursor-pointer hover:bg-muted/80"
          onClick={onToggleAll}
        >
          {allIncluded
            ? <CheckSquare className="h-4 w-4 text-primary shrink-0" />
            : <Square className="h-4 w-4 text-muted-foreground shrink-0" />
          }
          <span className="text-sm font-medium">
            {allIncluded ? 'Deselect All' : 'Select All'}
          </span>
        </div>
        {allGroups.map(group => {
          const included = !excludedGroups.has(group)
          return (
            <div
              key={group}
              className="flex items-center gap-3 px-4 py-2 border-b last:border-b-0 cursor-pointer hover:bg-muted/30"
              onClick={() => onToggle(group)}
            >
              {included
                ? <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                : <Square className="h-4 w-4 text-muted-foreground shrink-0" />
              }
              <span className="text-sm truncate">{group}</span>
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
