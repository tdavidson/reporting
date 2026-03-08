'use client'

import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useMediaQuery } from '@/lib/hooks/use-media-query'

interface MobileDrawerPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

export function MobileDrawerPanel({ open, onOpenChange, children }: MobileDrawerPanelProps) {
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  if (isDesktop) {
    if (!open) return null
    return (
      <div className="w-[340px] shrink-0 sticky top-4">
        {children}
      </div>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-0 pt-12 w-[340px] max-w-[85vw]">
        {children}
      </SheetContent>
    </Sheet>
  )
}
