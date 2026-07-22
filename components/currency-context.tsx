'use client'

import { createContext, useContext } from 'react'
export { getCurrencySymbol } from '@/lib/currency'
import { getCurrencySymbol } from '@/lib/currency'

const CurrencyContext = createContext<string>('USD')

export function CurrencyProvider({ currency, children }: { currency: string; children: React.ReactNode }) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  return useContext(CurrencyContext)
}

/** Normalize -0 to 0 */
function noNegZero(v: number): number {
  if (Object.is(v, -0)) return 0
  // Treat tiny negatives that round to $0 as zero
  if (v < 0 && v > -0.5) return 0
  return v
}

/** Abbreviated currency format: $1.2M, €500K, ¥1,000 */
export function formatCurrency(value: number, currency: string): string {
  const v = noNegZero(value)
  const symbol = getCurrencySymbol(currency)
  if (Math.abs(v) >= 1_000_000) {
    return `${symbol}${(v / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(v) >= 1_000) {
    return `${symbol}${(v / 1_000).toFixed(0)}K`
  }
  return v.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 })
}

/** Full-precision currency format: $1,234,567 */
export function formatCurrencyFull(value: number, currency: string): string {
  return noNegZero(value).toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 })
}

/** Full-precision currency with cents, always two decimals: $12.50, $1,234.00 */
export function formatCurrencyPrice(value: number, currency: string): string {
  // Only normalize -0 → 0 here; keep real sub-dollar amounts (cents matter).
  const v = Object.is(value, -0) ? 0 : value
  return v.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Per-SHARE price: shown to up to 4 decimals so sub-cent prices aren't lost ($1.20, $1.2345).
 *  The stored value keeps full precision and the valuation math uses it — this only widens the
 *  display so shares × price visibly ties out. */
export function formatSharePrice(value: number, currency: string): string {
  const v = Object.is(value, -0) ? 0 : value
  return v.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

