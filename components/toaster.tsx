'use client'

import { Toaster as Sonner } from 'sonner'
import { useTheme } from 'next-themes'

export function Toaster() {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={resolvedTheme as 'light' | 'dark' | undefined}
      richColors
      position="bottom-right"
      toastOptions={{
        className: 'text-sm',
      }}
    />
  )
}
