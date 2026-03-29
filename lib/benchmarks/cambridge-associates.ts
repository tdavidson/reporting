// Cambridge Associates VC Benchmark Quartiles
// Source: Cambridge Associates US Venture Capital Index — update quarterly
// Last updated: Q3 2024

export interface CAQuartile {
  vintage: number
  tvpi: { q1: number; median: number; q3: number }
  dpi: { q1: number; median: number; q3: number }
  rvpi: { q1: number; median: number; q3: number }
  netIrr: { q1: number; median: number; q3: number } // as decimals e.g. 0.15 = 15%
}

export const CA_BENCHMARKS: CAQuartile[] = [
  {
    vintage: 2015,
    tvpi: { q1: 3.85, median: 2.21, q3: 1.42 },
    dpi:  { q1: 2.90, median: 1.45, q3: 0.72 },
    rvpi: { q1: 1.10, median: 0.65, q3: 0.30 },
    netIrr: { q1: 0.248, median: 0.152, q3: 0.071 },
  },
  {
    vintage: 2016,
    tvpi: { q1: 3.42, median: 2.05, q3: 1.38 },
    dpi:  { q1: 2.20, median: 1.10, q3: 0.52 },
    rvpi: { q1: 1.25, median: 0.80, q3: 0.42 },
    netIrr: { q1: 0.235, median: 0.140, q3: 0.063 },
  },
  {
    vintage: 2017,
    tvpi: { q1: 3.10, median: 1.90, q3: 1.28 },
    dpi:  { q1: 1.60, median: 0.82, q3: 0.35 },
    rvpi: { q1: 1.55, median: 0.98, q3: 0.55 },
    netIrr: { q1: 0.218, median: 0.130, q3: 0.055 },
  },
  {
    vintage: 2018,
    tvpi: { q1: 2.75, median: 1.72, q3: 1.18 },
    dpi:  { q1: 1.05, median: 0.48, q3: 0.18 },
    rvpi: { q1: 1.70, median: 1.10, q3: 0.68 },
    netIrr: { q1: 0.195, median: 0.112, q3: 0.042 },
  },
  {
    vintage: 2019,
    tvpi: { q1: 2.42, median: 1.58, q3: 1.10 },
    dpi:  { q1: 0.72, median: 0.30, q3: 0.10 },
    rvpi: { q1: 1.78, median: 1.18, q3: 0.75 },
    netIrr: { q1: 0.178, median: 0.098, q3: 0.031 },
  },
  {
    vintage: 2020,
    tvpi: { q1: 2.18, median: 1.45, q3: 1.05 },
    dpi:  { q1: 0.45, median: 0.18, q3: 0.05 },
    rvpi: { q1: 1.82, median: 1.22, q3: 0.82 },
    netIrr: { q1: 0.162, median: 0.085, q3: 0.018 },
  },
  {
    vintage: 2021,
    tvpi: { q1: 1.55, median: 1.12, q3: 0.88 },
    dpi:  { q1: 0.18, median: 0.06, q3: 0.02 },
    rvpi: { q1: 1.42, median: 1.02, q3: 0.75 },
    netIrr: { q1: 0.092, median: 0.028, q3: -0.025 },
  },
  {
    vintage: 2022,
    tvpi: { q1: 1.25, median: 1.02, q3: 0.82 },
    dpi:  { q1: 0.08, median: 0.02, q3: 0.00 },
    rvpi: { q1: 1.20, median: 0.98, q3: 0.78 },
    netIrr: { q1: 0.065, median: 0.012, q3: -0.038 },
  },
  {
    vintage: 2023,
    tvpi: { q1: 1.10, median: 0.95, q3: 0.78 },
    dpi:  { q1: 0.02, median: 0.00, q3: 0.00 },
    rvpi: { q1: 1.08, median: 0.92, q3: 0.75 },
    netIrr: { q1: 0.040, median: -0.010, q3: -0.055 },
  },
]

export function getBenchmarkForVintage(vintage: number): CAQuartile | null {
  return CA_BENCHMARKS.find(b => b.vintage === vintage) ?? null
}

export function getQuartilePosition(
  value: number,
  quartiles: { q1: number; median: number; q3: number },
  higherIsBetter = true
): 'top_quartile' | 'upper_mid' | 'lower_mid' | 'bottom_quartile' {
  if (higherIsBetter) {
    if (value >= quartiles.q1) return 'top_quartile'
    if (value >= quartiles.median) return 'upper_mid'
    if (value >= quartiles.q3) return 'lower_mid'
    return 'bottom_quartile'
  } else {
    if (value <= quartiles.q3) return 'top_quartile'
    if (value <= quartiles.median) return 'upper_mid'
    if (value <= quartiles.q1) return 'lower_mid'
    return 'bottom_quartile'
  }
}
