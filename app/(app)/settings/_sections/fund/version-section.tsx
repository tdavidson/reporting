'use client'

import Link from 'next/link'
import { Lock } from 'lucide-react'

export function VersionSection({ appVersion, updateAvailable }: { appVersion: string; updateAvailable: boolean }) {
  return (
    <div className="rounded-card border border-warning/30 bg-card p-5">
      <h2 className="text-sm font-medium mb-1 flex items-center gap-1.5">
        <Lock className="h-3 w-3 text-warning" />
        Version
      </h2>
      {updateAvailable ? (
        <p className="text-xs text-muted-foreground">
          You are running <span className="font-mono font-medium text-foreground">v{appVersion}</span>. A newer version is available.{' '}
          <Link href="/updates" className="text-warning underline underline-offset-4 hover:text-warning">
            View update details
          </Link>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          You are running <span className="font-mono font-medium text-foreground">v{appVersion}</span> and are up to date.{' '}
          <a
            href="https://github.com/tdavidson/reporting/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            View releases on GitHub
          </a>
        </p>
      )}
    </div>
  )
}
