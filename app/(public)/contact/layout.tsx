import type { Metadata } from 'next'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://portfolio.hemrock.com'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch to discuss deployment, setup, support, or hosting for Analyst portfolio reporting.',
  openGraph: {
    title: 'Contact',
    description: 'Get in touch to discuss deployment, setup, support, or hosting for Analyst portfolio reporting.',
    images: [{ url: `${BASE_URL}/screenshots/contact.png`, width: 1200, height: 630, alt: 'Contact' }],
    type: 'website',
    siteName: 'Analyst by Hemrock',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact',
    description: 'Get in touch to discuss deployment, setup, support, or hosting for Analyst portfolio reporting.',
    images: [`${BASE_URL}/screenshots/contact.png`],
  },
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children
}
