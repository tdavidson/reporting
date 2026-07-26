import { describe, it, expect } from 'vitest'
import { parseSiteContent, resolveIcon, type SiteContent } from './content'
import { Circle, Mail } from 'lucide-react'

const valid: SiteContent = {
  hero: { title: 'Run your fund', subtitle: 'Open source portfolio reporting.', emphasis: 'without the spreadsheets.' },
  stats: [{ value: '$20B', label: 'Assets under administration' }],
  productGroups: [
    {
      key: 'portfolio_reporting',
      label: 'Portfolio Reporting',
      description: 'Inbound updates, metrics, dashboards.',
      eyebrow: 'The platform',
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
    expect(out?.stats).toEqual([])
  })

  it('drops the hero emphasis when it is blank, keeping the headline', () => {
    const out = parseSiteContent({ ...valid, hero: { title: 'A', subtitle: 'B', emphasis: '   ' } })
    expect(out?.hero.title).toBe('A')
    expect(out?.hero.emphasis).toBeUndefined()
  })

  it('drops the section eyebrow when blank but keeps the group', () => {
    const out = parseSiteContent({ ...valid, productGroups: [{ ...valid.productGroups[0], eyebrow: '' }] })
    expect(out?.productGroups).toHaveLength(1)
    expect(out?.productGroups[0].eyebrow).toBeUndefined()
  })

  it('drops stats missing a value or label', () => {
    const out = parseSiteContent({
      ...valid,
      stats: [{ value: '90%', label: 'Auto-categorised' }, { value: '', label: 'x' }, { value: 'y' }, 'nope'],
    })
    expect(out?.stats).toEqual([{ value: '90%', label: 'Auto-categorised' }])
  })

  it('drops an invalid product-group key but keeps the group', () => {
    const bad = { ...valid, productGroups: [{ ...valid.productGroups[0], key: 'not_a_product' }] }
    const out = parseSiteContent(bad)
    expect(out?.productGroups).toHaveLength(1)
    expect(out?.productGroups[0].key).toBeUndefined()
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
  it('falls back to Circle for Object.prototype member names', () => {
    expect(resolveIcon('constructor')).toBe(Circle)
    expect(resolveIcon('toString')).toBe(Circle)
    expect(resolveIcon('hasOwnProperty')).toBe(Circle)
  })
})
