import Link from 'next/link'
import { getPortalFund } from '@/lib/portal-fund'
import { themeCssVars } from '@/lib/theme'

export const metadata = { title: 'Investor Portal' }

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const fund = await getPortalFund()
  const themeVars = themeCssVars(fund?.theme ?? null)
  const fundName = fund?.name ?? 'Investor Portal'

  return (
    <div className="min-h-screen bg-muted/20">
      {themeVars && <style dangerouslySetInnerHTML={{ __html: `:root{${themeVars}}` }} />}
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4">
          <div className="py-3 flex items-center justify-between gap-3">
            <Link href="/portal/snapshots" className="flex items-center gap-2 min-w-0 font-semibold text-sm tracking-tight">
              {fund?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fund.logoUrl} alt="" className="h-6 w-auto max-w-[120px] object-contain shrink-0" />
              ) : null}
              <span className="truncate">{fundName}</span>
            </Link>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="text-xs text-muted-foreground hover:text-foreground shrink-0">
                Sign out
              </button>
            </form>
          </div>
          <nav className="flex items-center gap-4 -mb-px overflow-x-auto">
            <Link href="/portal/snapshots" className="text-sm text-muted-foreground hover:text-foreground py-2 border-b-2 border-transparent whitespace-nowrap">
              Reports
            </Link>
            <Link href="/portal/letters" className="text-sm text-muted-foreground hover:text-foreground py-2 border-b-2 border-transparent whitespace-nowrap">
              Letters
            </Link>
            <Link href="/portal/documents" className="text-sm text-muted-foreground hover:text-foreground py-2 border-b-2 border-transparent whitespace-nowrap">
              Documents
            </Link>
            <Link href="/portal/authorized-users" className="text-sm text-muted-foreground hover:text-foreground py-2 border-b-2 border-transparent whitespace-nowrap">
              Authorized users
            </Link>
            <Link href="/portal/contact" className="text-sm text-muted-foreground hover:text-foreground py-2 border-b-2 border-transparent whitespace-nowrap">
              Contact
            </Link>
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
