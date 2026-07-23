import type { FeatureKey, FeatureVisibility, FeatureVisibilityMap } from '@/lib/types/features'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'
import { DOMAIN_META, type Domain } from '@/lib/access/domains'

export type ProductKey = 'portfolio_reporting' | 'investment_workflow' | 'lp_reporting' | 'fund_operations'

export interface ProductMeta {
  label: string
  description: string
  order: number
  shipsOn: boolean
  /** Domains this product owns. Its features are the union of these domains' features. */
  domains: Domain[]
  /** Every FeatureKey appears under exactly one product (pinned by products.test.ts). */
  features: FeatureKey[]
}

export const PRODUCT_META: Record<ProductKey, ProductMeta> = {
  portfolio_reporting: {
    label: 'Portfolio Reporting',
    description: 'Inbound updates, metrics, the review queue, dashboards, asks, and fund notes.',
    order: 1,
    shipsOn: true,
    domains: ['portfolio', 'relationships'],
    features: ['investments', 'imports', 'asks', 'interactions', 'notes'],
  },
  investment_workflow: {
    label: 'Investment Workflow',
    description: 'Inbound deal intake, diligence, research, and memo drafting.',
    order: 2,
    shipsOn: false,
    domains: ['dealflow', 'diligence'],
    features: ['deals', 'diligence'],
  },
  lp_reporting: {
    label: 'LP Reporting',
    description: 'LP capital accounts, the LP portal, shared documents, and the activity log.',
    order: 3,
    shipsOn: false,
    domains: ['lp_capital', 'lp_relations'],
    features: ['lps', 'lp_tracking', 'lp_letters', 'lp_portal', 'lp_activity'],
  },
  fund_operations: {
    label: 'Fund Operations',
    description: 'Fund accounting, GP economics and carry, and compliance.',
    order: 4,
    shipsOn: false,
    domains: ['accounting', 'gp_economics', 'compliance'],
    features: ['accounting', 'gp_economics', 'compliance'],
  },
}

export function orderedProducts(): ProductKey[] {
  return (Object.keys(PRODUCT_META) as ProductKey[]).sort((a, b) => PRODUCT_META[a].order - PRODUCT_META[b].order)
}

export function featuresForProduct(p: ProductKey): FeatureKey[] {
  return PRODUCT_META[p].features
}

export function productForFeature(f: FeatureKey): ProductKey {
  const hit = orderedProducts().find(p => PRODUCT_META[p].features.includes(f))
  if (!hit) throw new Error(`Feature "${f}" is not assigned to any product`)
  return hit
}

export function productForDomain(d: Domain): ProductKey {
  const hit = orderedProducts().find(p => PRODUCT_META[p].domains.includes(d))
  if (!hit) throw new Error(`Domain "${d}" is not assigned to any product`)
  return hit
}

/** A product is "active" (turned on for the fund) when at least one of its features is
 *  visible — i.e. not `off` and not `hidden`. Both deny every surface. */
export function isProductActive(p: ProductKey, fv: FeatureVisibilityMap | null | undefined): boolean {
  return PRODUCT_META[p].features.some(f => {
    const v: FeatureVisibility = fv?.[f] ?? DEFAULT_FEATURE_VISIBILITY[f]
    return v !== 'off' && v !== 'hidden'
  })
}

export function groupFeaturesByProduct(): Array<{ product: ProductKey; features: FeatureKey[] }> {
  return orderedProducts().map(product => ({ product, features: featuresForProduct(product) }))
}
