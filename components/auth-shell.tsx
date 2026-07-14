import Link from 'next/link'
import { Building2 } from 'lucide-react'

/**
 * The chrome for every signed-out, full-page screen: sign-in, sign-up, password reset,
 * MFA, and the OAuth consent screen.
 *
 * It exists because that chrome was previously copy-pasted — byte for byte — into six auth
 * pages, while the OAuth pages had none of it at all and consequently looked like a
 * different product bolted on at the moment a user is being asked to hand an agent the
 * keys to their fund. That is the worst possible place to look unfamiliar.
 *
 * The wordmark links home. Someone who lands here from the demo and decides not to sign in
 * has no other way back to the marketing site.
 */
export function AuthShell({
  children,
  above,
  footer,
  wide,
}: {
  children: React.ReactNode
  /** Rendered ABOVE the wordmark — the sign-up page's "try the demo" banner leads with this. */
  above?: React.ReactNode
  /** Rendered under the card, in fine print. */
  footer?: React.ReactNode
  /** The consent screen carries more text than a login form and needs the extra room. */
  wide?: boolean
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className={`w-full space-y-6 ${wide ? 'max-w-lg' : 'max-w-md'}`}>
        {above}
        <AuthWordmark />
        {children}
        {footer}
      </div>
    </div>
  )
}

/** The logo tile + product name, linked home. */
export function AuthWordmark() {
  return (
    <div className="text-center">
      <Link href="/" className="inline-block group">
        <div className="h-10 w-10 rounded bg-muted flex items-center justify-center mx-auto mb-2 transition-colors group-hover:bg-muted-foreground/20">
          <Building2 className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Portfolio Reporting</h1>
      </Link>
    </div>
  )
}
