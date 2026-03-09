import Image from 'next/image'
import type { LucideIcon } from 'lucide-react'

interface ExplainerContentProps {
  title: string
  icon: LucideIcon
  screenshotSrc: string
  screenshotLabel: string
  children: React.ReactNode
}

export function ExplainerContent({ title, icon: Icon, screenshotSrc, screenshotLabel, children }: ExplainerContentProps) {
  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-6 flex items-center gap-3">
        <Icon className="h-6 w-6 text-muted-foreground" />
        {title}
      </h1>

      <Image
        src={screenshotSrc}
        alt={screenshotLabel}
        width={1200}
        height={900}
        className="w-full h-auto rounded-lg border shadow-sm mb-8"
        priority
      />

      <div className="space-y-4 text-sm leading-relaxed">
        {children}
      </div>
    </div>
  )
}
