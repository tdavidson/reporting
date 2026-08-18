'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close
const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: 'left' | 'right' | 'bottom'
  }
>(({ side = 'left', className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // overflow-y-auto is not cosmetic. A sheet is `inset-y-0 h-full` and Radix locks
        // the page behind it (react-remove-scroll), so without a scroller of its own
        // anything past the fold is unreachable — not clipped, not scrolled to, simply
        // gone. On a phone the app's nav is ~975px against a ~665px viewport, which made
        // roughly a third of the menu untappable and is what "the mobile nav doesn't
        // work" turned out to mean. overscroll-contain keeps a flick at the end of the
        // list from being handed to the page underneath.
        'fixed z-50 gap-4 bg-background p-6 shadow-lg overflow-y-auto overscroll-contain transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500',
        side === 'left' &&
          'inset-y-0 left-0 h-full w-3/4 max-w-sm border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
        side === 'right' &&
          'inset-y-0 right-0 h-full w-3/4 max-w-sm border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
        // A sheet that rises from the bottom edge, for a control that lives there.
        // `svh` rather than `vh` because a phone browser's `vh` includes the collapsing
        // URL bar, so 85vh puts the top of the sheet — its header — off screen on first
        // paint. Height is capped rather than set, so a short menu is a short sheet.
        side === 'bottom' &&
          'inset-x-0 bottom-0 max-h-[85svh] rounded-t-card border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = DialogPrimitive.Content.displayName

/**
 * The sheet's accessible name. Radix warns without one, and a screen reader otherwise
 * announces the dialog with no idea what opened. Usually `sr-only` — a sheet whose
 * purpose is obvious on screen still needs to say it out loud.
 */
const SheetTitle = DialogPrimitive.Title

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetOverlay, SheetPortal, SheetTitle }
