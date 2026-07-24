import { describe, it, expect } from 'vitest'
import { parseSiteContent, resolveIcon, type SiteContent } from './content'
import { Circle, Mail } from 'lucide-react'

const valid: SiteContent = {
  hero: { title: 'Run your fund', subtitle: 'Open source portfolio reporting.' },
  productGroups: [
    {
      key: 'portfolio_reporting',
      label: 'Portfolio Reporting',
      description: 'Inbound updates, metrics, dashboards.',
      heroScreenshot: '/screenshots/dashboard-cropped.png',
      features: [
        { title: 'Forward updates', text: 'Send investor updates.', icon: 'Mail', screenshot: '/screenshots/inbound-cropped.png' },
      ],
    },
  ],
  why: [{ icon: 'Database', title: 'One source of truth', text: 'No spreadsheet maze.' }],
  pricing: {
    note: 'Free and open source.',
    tiers: [{ name: 'Self-Hosted', price: 'Free', bullets: ['Apache 2.0'], cta: { kind: 'link', label: 'GitHub', href: 'https://github.com/tdavidson/reporting' } }],
  },
  faqs: [{ q: 'Why?', a: 'Because [reasons](https://x.com).' }],
  about: { name: 'Taylor Davidson', bio: 'CFO and investor.', links: [{ label: 'X', href: 'https://x.com/tdavidson' }] },
  links: { github: 'https://github.com/tdavidson/reporting', x: 'https://x.com/tdavidson', demo: 'https://portfolio.hemrock.com/demo' },
}

describe('parseSiteContent', () => {
  it('accepts a fully-formed document', () => {
    expect(parseSiteContent(valid)).toEqual(valid)
  })

  it('returns null for empty / missing content', () => {
    expect(parseSiteContent(null)).toBeNull()
    expect(parseSiteContent({})).toBeNull()
    expect(parseSiteContent({ hero: { title: '', subtitle: '' } })).toBeNull()
  })

  it('returns null when hero title is missing', () => {
    const bad = { ...valid, hero: { subtitle: 'x' } }
    expect(parseSiteContent(bad)).toBeNull()
  })

  it('drops a product group with no features but keeps valid ones', () => {
    const mixed = { ...valid, productGroups: [{ label: 'Empty', description: 'x', features: [] }, ...valid.productGroups] }
    const out = parseSiteContent(mixed)
    expect(out?.productGroups).toHaveLength(1)
    expect(out?.productGroups[0].label).toBe('Portfolio Reporting')
  })

  it('coerces missing optional arrays to empty arrays', () => {
    const min = { hero: valid.hero, productGroups: valid.productGroups }
    const out = parseSiteContent(min)
    expect(out).not.toBeNull()
    expect(out?.why).toEqual([])
    expect(out?.faqs).toEqual([])
    expect(out?.pricing.tiers).toEqual([])
    expect(out?.links).toEqual({})
  })
})

describe('resolveIcon', () => {
  it('resolves a known icon name', () => {
    expect(resolveIcon('Mail')).toBe(Mail)
  })
  it('falls back to Circle for unknown/missing', () => {
    expect(resolveIcon('NotAnIcon')).toBe(Circle)
    expect(resolveIcon(undefined)).toBe(Circle)
  })
})
