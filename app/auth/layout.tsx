import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'
// Gated app routes bounce to /auth?next=<route>, and Google had filed seven of
// those query-string variants as "duplicate without user-selected canonical".
// A crawlable noindex drops them; blocking /auth in robots would only hide the
// noindex from the crawler.
export const metadata: Metadata = { title: 'Sign In', robots: { index: false, follow: false } }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
