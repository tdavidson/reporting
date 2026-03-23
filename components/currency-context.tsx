'use client'

import { createContext, useContext } from 'react'
import { getCurrencySymbol } from '@/lib/currency'
export { getCurrencySymbol } from '@/lib/currency'

const CurrencyContext = createContext<string>('USD')

export function CurrencyProvider({ currency, children }: { currency: string; children: React.ReactNode }) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  return useContext(CurrencyContext)
}

function noNegZero(v: number): number {
  if (Object.is(v, -0)) return 0
  if (v < 0 && v > -0.5) return 0
  return v
}

/** FORMATAÇÃO DOS CARDS (Ex: R$2,100.0M) */
export function formatCurrency(value: number, currency: string): string {
  const v = noNegZero(value)
  const symbol = getCurrencySymbol(currency)
  
  if (Math.abs(v) >= 1_000_000) {
    const num = (v / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    return `${symbol}${num}M`
  }
  
  if (Math.abs(v) >= 1_000) {
    const num = (v / 1_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    return `${symbol}${num}K`
  }
  
  return v.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function formatCurrencyFull(value: number, currency: string): string {
  return noNegZero(value).toLocaleString('en-US', { 
    style: 'currency', 
    currency, 
    minimumFractionDigits: 1, 
    maximumFractionDigits: 1 
  })
}

export function formatCurrencyPrice(value: number, currency: string): string {
  return noNegZero(value).toLocaleString('en-US', { 
    style: 'currency', 
    currency, 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })
}
