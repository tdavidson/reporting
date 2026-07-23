import { describe, it, expect } from 'vitest'
import { PRODUCT_META, productForFeature, featuresForProduct, productForDomain, isProductActive, orderedProducts, groupFeaturesByProduct, recommendedVisibilityForProduct, disabledVisibilityForProduct, type ProductKey } from './products'
import { DEFAULT_FEATURE_VISIBILITY, type FeatureKey, type FeatureVisibilityMap } from '@/lib/types/features'
import { DOMAIN_META, type Domain } from './domains'

const ALL_FEATURES = Object.keys(DEFAULT_FEATURE_VISIBILITY) as FeatureKey[]

describe('PRODUCT_META', () => {
  it('assigns every FeatureKey to exactly one product', () => {
    for (const f of ALL_FEATURES) {
      const owners = orderedProducts().filter(p => PRODUCT_META[p].features.includes(f))
      expect(owners, `feature ${f}`).toHaveLength(1)
    }
  })

  it('has no feature listed under a product that is not a real FeatureKey', () => {
    for (const p of orderedProducts()) {
      for (const f of PRODUCT_META[p].features) expect(ALL_FEATURES).toContain(f)
    }
  })

  it('maps every DOMAIN_META domain (except admin) to exactly one product', () => {
    const domains = (Object.keys(DOMAIN_META) as Domain[]).filter(d => d !== 'admin')
    for (const d of domains) {
      const owners = orderedProducts().filter(p => PRODUCT_META[p].domains.includes(d))
      expect(owners, `domain ${d}`).toHaveLength(1)
      expect(productForDomain(d)).toBe(owners[0])
    }
  })

  it('orders products 1..4', () => {
    expect(orderedProducts()).toEqual(['portfolio_reporting', 'investment_workflow', 'lp_reporting', 'fund_operations'])
  })

  it('exactly one product ships on', () => {
    expect(orderedProducts().filter(p => PRODUCT_META[p].shipsOn)).toEqual(['portfolio_reporting'])
  })

  it('productForFeature returns the owning product', () => {
    expect(productForFeature('deals')).toBe('investment_workflow')
    expect(productForFeature('accounting')).toBe('fund_operations')
    expect(productForFeature('notes')).toBe('portfolio_reporting')
    expect(productForFeature('gp_economics')).toBe('fund_operations')
  })

  it('isProductActive is true when any feature is not off/hidden', () => {
    const allOff = Object.fromEntries(ALL_FEATURES.map(f => [f, 'off'])) as FeatureVisibilityMap
    expect(isProductActive('lp_reporting', allOff)).toBe(false)
    const oneOn: FeatureVisibilityMap = { ...allOff, lps: 'admin' }
    expect(isProductActive('lp_reporting', oneOn)).toBe(true)
    const hidden: FeatureVisibilityMap = { ...allOff, lps: 'hidden' }
    expect(isProductActive('lp_reporting', hidden)).toBe(false)
  })

  it('ship defaults have only Portfolio Reporting active', () => {
    const active = orderedProducts().filter(p => isProductActive(p, DEFAULT_FEATURE_VISIBILITY))
    expect(active).toEqual(['portfolio_reporting'])
  })

  it("each product's features equal the union of its domains' features", () => {
    for (const p of orderedProducts()) {
      const fromDomains = PRODUCT_META[p].domains.flatMap(d => DOMAIN_META[d].features)
      expect(Array.from(new Set(PRODUCT_META[p].features)).sort()).toEqual(Array.from(new Set(fromDomains)).sort())
    }
  })

  it('groups all features by product in order', () => {
    const groups = groupFeaturesByProduct()
    expect(groups.map(g => g.product)).toEqual(orderedProducts())
    const flat = groups.flatMap(g => g.features)
    expect(flat.sort()).toEqual((Object.keys(DEFAULT_FEATURE_VISIBILITY) as FeatureKey[]).sort())
  })

  it("recommendedVisibilityForProduct turns all of a product's features on", () => {
    const rec = recommendedVisibilityForProduct('lp_reporting')
    for (const f of featuresForProduct('lp_reporting')) {
      expect(rec[f]).toBeDefined()
      expect(rec[f]).not.toBe('off')
      expect(rec[f]).not.toBe('hidden')
    }
  })

  it("disabledVisibilityForProduct sets all of a product's features off", () => {
    const dis = disabledVisibilityForProduct('lp_reporting')
    for (const f of featuresForProduct('lp_reporting')) expect(dis[f]).toBe('off')
  })
})
