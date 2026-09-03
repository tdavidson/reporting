import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Offline' }

/**
 * The one document public/sw.js precaches, shown when a navigation fails because the
 * device has no network.
 *
 * Must stay fully static — it renders from the cache with nothing reachable, so it
 * cannot read cookies, call the database, or resolve the fund's theme. It is also
 * reachable anonymously (see proxy.ts), because the worker fetches it at install
 * time, which can happen before anyone has signed in.
 *
 * Reload is a plain form submit rather than an onClick, so this needs no client
 * bundle to be useful.
 */
export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center max-w-sm">
        <p className="text-heading mb-2">You&apos;re offline</p>
        <p className="text-sm text-muted-foreground mb-6">
          This app needs a connection to show fund data. Nothing has been lost — reopen
          the page once you&apos;re back online.
        </p>
        <form>
          <button
            type="submit"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Try again
          </button>
        </form>
      </div>
    </div>
  )
}
