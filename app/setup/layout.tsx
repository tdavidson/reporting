import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Setup Checklist' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
