'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

declare global {
  interface Window {
    Calendly?: {
      initPopupWidget: (opts: { url: string }) => void
    }
  }
}

export function CalendlyButton({ url, children, className }: { url: string; children: React.ReactNode; className?: string }) {
  useEffect(() => {
    // Load Calendly CSS
    if (!document.querySelector('link[href*="calendly.com/assets/external/widget.css"]')) {
      const link = document.createElement('link')
      link.href = 'https://assets.calendly.com/assets/external/widget.css'
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    // Load Calendly JS
    if (!document.querySelector('script[src*="calendly.com/assets/external/widget.js"]')) {
      const script = document.createElement('script')
      script.src = 'https://assets.calendly.com/assets/external/widget.js'
      script.async = true
      document.head.appendChild(script)
    }
  }, [])

  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={(e) => {
        e.preventDefault()
        const sep = url.includes('?') ? '&' : '?'
        window.Calendly?.initPopupWidget({ url: `${url}${sep}hide_event_type_details=1` })
      }}
    >
      {children}
    </Button>
  )
}
