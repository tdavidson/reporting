import { describe, it, expect } from 'vitest'
import { syncableFeeds } from './quote-sync'
import { parseDriveFileUrl } from '@/lib/google/drive'
import { resolveQuotes, providerFor, PROVIDER_NAMES } from './quote-providers'
import type { PriceFeed } from './quotes'

const feed = (o: Partial<PriceFeed> = {}): PriceFeed => ({
  id: 'f1', companyId: 'c1', kind: 'listed_equity', symbol: 'AAPL',
  exchange: 'NASDAQ', quoteCurrency: 'USD', quoteScale: 1,
  activeFrom: '2026-01-01', activeUntil: null,
  restrictionUntil: null, restrictionDiscount: null,
  ...o,
})

describe('syncableFeeds', () => {
  it('skips a manually priced feed — nothing to ask a provider', () => {
    const feeds = [feed({ id: 'a' }), feed({ id: 'b' })]
    const providers = new Map([['a', 'manual'], ['b', 'google_sheets']])
    expect(syncableFeeds(feeds, providers, '2026-03-31').map(f => f.id)).toEqual(['b'])
  })

  it('treats an unconfigured feed as manual rather than guessing a provider', () => {
    expect(syncableFeeds([feed()], new Map(), '2026-03-31')).toEqual([])
  })

  it('skips a feed that is not active today', () => {
    const providers = new Map([['f1', 'google_sheets']])
    expect(syncableFeeds([feed({ activeFrom: '2026-06-01' })], providers, '2026-03-31')).toEqual([])
    expect(syncableFeeds([feed({ activeUntil: '2026-02-01' })], providers, '2026-03-31')).toEqual([])
  })
})

describe('provider registry', () => {
  it('falls back to manual for an unknown provider instead of throwing', () => {
    expect(providerFor('a-vendor-we-dropped').name).toBe('manual')
    expect(providerFor(null).name).toBe('manual')
  })

  it('exposes the configured providers', () => {
    expect(PROVIDER_NAMES).toContain('manual')
    expect(PROVIDER_NAMES).toContain('google_sheets')
  })

  it('never calls a provider for manual feeds', async () => {
    const { quotes, errors } = await resolveQuotes(
      [feed()], { fundId: 'f' }, new Map([['f1', 'manual']]),
    )
    expect(quotes).toEqual([])
    expect(errors).toEqual([])
  })

  it('isolates one provider failure from the others', async () => {
    // Registered ad hoc so the test does not depend on which vendors ship.
    const providers = new Map([['f1', 'google_sheets']])
    // google_sheets with no sheet configured returns nothing rather than throwing.
    const { quotes, errors } = await resolveQuotes(
      [feed()], { fundId: 'f', quoteSheetFileId: null }, providers,
    )
    expect(quotes).toEqual([])
    expect(errors).toEqual([])
  })
})

describe('parseDriveFileUrl', () => {
  it('reads a Sheets edit URL', () => {
    expect(parseDriveFileUrl('https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=0'))
      .toBe('1AbC_dEf-123')
  })

  it('reads a Drive file URL', () => {
    expect(parseDriveFileUrl('https://drive.google.com/file/d/1AbC_dEf-123/view')).toBe('1AbC_dEf-123')
  })

  it('accepts a bare id', () => {
    expect(parseDriveFileUrl('1AbCdEfGhIjKlMnOpQrStUvWxYz')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz')
  })

  it('refuses a link that is not a Drive file', () => {
    expect(parseDriveFileUrl('https://example.com/prices')).toBeNull()
    expect(parseDriveFileUrl('not a url')).toBeNull()
    expect(parseDriveFileUrl('')).toBeNull()
  })
})
