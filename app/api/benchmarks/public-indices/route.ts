import { NextResponse } from 'next/server'

export const revalidate = 21600

interface DataPoint { date: string; value: number }

// -------------------------------------------------------------------------
// BACEN: returns daily (CDI s.12) or monthly (IPCA s.433) data.
// We accumulate into a running index, then collapse to MONTHLY last-day value
// so the series aligns with our monthly NAV chart.
// -------------------------------------------------------------------------
async function fetchBACEN(seriesCode: number, startDate: string): Promise<DataPoint[]> {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesCode}/dados?formato=json&dataInicial=${startDate}`
  try {
    const res = await fetch(url, { next: { revalidate: 21600 } })
    if (!res.ok) return []
    const raw: { data: string; valor: string }[] = await res.json()

    // Accumulate running index
    let index = 100
    const accumulated: { ym: string; date: string; value: number }[] = []
    for (const r of raw) {
      index = index * (1 + parseFloat(r.valor.replace(',', '.')) / 100)
      // BACEN date format: DD/MM/YYYY
      const parts = r.data.split('/')
      if (parts.length !== 3) continue
      const iso = `${parts[2]}-${parts[1]}-${parts[0]}` // YYYY-MM-DD
      const ym  = iso.slice(0, 7)                        // YYYY-MM
      accumulated.push({ ym, date: iso, value: parseFloat(index.toFixed(4)) })
    }

    // Keep only the LAST entry per month (end-of-month value)
    const monthMap = new Map<string, DataPoint>()
    for (const pt of accumulated) {
      monthMap.set(pt.ym, { date: pt.date, value: pt.value })
    }
    return Array.from(monthMap.values()).sort((a, b) => a.date.localeCompare(b.date))
  } catch {
    return []
  }
}

// -------------------------------------------------------------------------
// Yahoo Finance: already monthly (interval=1mo). Normalise date to last day
// of that month so it aligns with BACEN and NAV series.
// -------------------------------------------------------------------------
async function fetchYahooFinance(ticker: string, startDate: string): Promise<DataPoint[]> {
  try {
    const start = Math.floor(new Date(startDate).getTime() / 1000)
    const end   = Math.floor(Date.now() / 1000)
    const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1mo&includeAdjustedClose=true`
    const res   = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 21600 },
    })
    if (!res.ok) return []
    const json = await res.json()
    const timestamps: number[] = json?.chart?.result?.[0]?.timestamp ?? []
    const closes: number[]     = json?.chart?.result?.[0]?.indicators?.adjclose?.[0]?.adjclose ?? []
    if (timestamps.length === 0) return []
    const base = closes[0]
    if (!base || base === 0) return []

    return timestamps.map((ts, i) => {
      const d   = new Date(ts * 1000)
      // Snap to last day of that month
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      const date    = lastDay.toISOString().split('T')[0]
      return {
        date,
        value: parseFloat(((closes[i] / base) * 100).toFixed(4)),
      }
    }).filter(d => d.value != null && !isNaN(d.value))
  } catch {
    return []
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const startDate = searchParams.get('startDate') ?? '2020-01-01'

  // BACEN expects DD/MM/YYYY
  const bacenStart = startDate.includes('-')
    ? startDate.split('-').reverse().join('/')
    : startDate

  // Yahoo expects YYYY-MM-DD
  const yahooStart = startDate.includes('/')
    ? startDate.split('/').reverse().join('-')
    : startDate

  const [cdi, ipca, ibov, sp500] = await Promise.all([
    fetchBACEN(12, bacenStart),
    fetchBACEN(433, bacenStart),
    fetchYahooFinance('^BVSP', yahooStart),
    fetchYahooFinance('^GSPC', yahooStart),
  ])

  return NextResponse.json({
    cdi:   { series: cdi,   latest: cdi.at(-1)?.value   ?? null, label: 'CDI' },
    ipca:  { series: ipca,  latest: ipca.at(-1)?.value  ?? null, label: 'IPCA' },
    ibov:  { series: ibov,  latest: ibov.at(-1)?.value  ?? null, label: 'Ibovespa' },
    sp500: { series: sp500, latest: sp500.at(-1)?.value ?? null, label: 'S&P 500' },
  })
}
