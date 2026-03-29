export interface VCDeal {
  id: string
  fund_id: string
  company_name: string
  amount_usd: number | null
  deal_date: string | null
  stage: string | null
  investors: string[]
  segment: string | null
  country: string | null
  source_url: string | null
  source: 'scrape' | 'import' | 'manual'
  created_at: string
  updated_at: string
}
 
export type VCDealInsert = Omit<VCDeal, 'id' | 'created_at' | 'updated_at'>
 
export interface VCFilters {
  period: string   // 'ytd' | 'last_year' | '2025' | 'q1' | 'q2' | 'q3' | 'q4' | 'all'
  country: string
  segment: string
  stage: string
  investor: string
}
 
export interface VCKPIs {
  totalRounds: number
  totalCapital: number
  uniqueCompanies: number
  avgTicket: number
  activeCountries: number
}
 
export interface ScrapeResult {
  inserted: number
  skipped: number
  errors: string[]
}
 
export interface ImportResult {
  inserted: number
  skipped: number
  errors: string[]
}
