import { NextResponse } from 'next/server'

// Revalidate every 6 hours
export const revalidate = 21600

interface DataPoint { date: string; value: number }

async function fetchBACEN(seriesCode: number, startDate: string): Promise<DataPoint[]> {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesCode}/dados?formato=json&dataInicial=${startDate}`
  try {
    const res = await fetch(url, { next: { revalidate: 21600 } })
    if (!res.ok) return []
    const raw: { data: string; valor: string }[] = await res.json()
    // Accumulate into index (base 100)
    let index = 100
    return raw.map(r => {
      index = index * (1 + parseFloat(r.valor.replace(',', '.')) / 100)
      return { date: r.data, value: parseFloat(index.toFixed(4)) }
    })
  } catch {
    return []
  }
}

async function fetchYahooFinance(ticker: string, startDate: string): Promise<DataPoint[]> {
  try {
    const start = Math.floor(new Date(startDate).getTime() / 1000)
    const end = Math.floor(Date.now() / 1000)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1mo&includeAdjustedClose=true`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 21600 },
    })
    if (!res.ok) return []
    const json = await res.json()
    const timestamps: number[] = json?.chart?.result?.[0]?.timestamp ?? []
    const closes: number[] = json?.chart?.result?.[0]?.indicators?.adjclose?.[0]?.adjclose ?? []
    if (timestamps.length === 0) return []
    const base = closes[0]
    return timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      value: base > 0 ? parseFloat(((closes[i] / base) * 100).toFixed(4)) : closes[i],
    })).filter(d => d.value != null && !isNaN(d.value))
  } catch {
    return []
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const startDate = searchParams.get('startDate') ?? '01/01/2020'
  // Convert YYYY-MM-DD to DD/MM/YYYY for BACEN
  const bacenStart = startDate.includes('-')
    ? startDate.split('-').reverse().join('/')
    : startDate

  const yahooStart = startDate.includes('/')
    ? startDate.split('/').reverse().join('-')
    : startDate

  const [cdi, ipca, ibov, sp500] = await Promise.all([
    fetchBACEN(12, bacenStart),    // CDI diário
    fetchBACEN(433, bacenStart),   // IPCA mensal
    fetchYahooFinance('^BVSP', yahooStart),
    fetchYahooFinance('^GSPC', yahooStart),
  ])

  // Return last value (total return since startDate, base 100)
  const summary = {
    cdi:   { series: cdi,   latest: cdi.at(-1)?.value ?? null,   label: 'CDI' },
    ipca:  { series: ipca,  latest: ipca.at(-1)?.value ?? null,  label: 'IPCA' },
    ibov:  { series: ibov,  latest: ibov.at(-1)?.value ?? null,  label: 'Ibovespa' },
    sp500: { series: sp500, latest: sp500.at(-1)?.value ?? null, label: 'S&P 500' },
  }

  return NextResponse.json(summary)
}
