import { describe, it, expect } from 'vitest'
import {
  balanceAsOf, observedByHolding, walletVariances, walletCloseIssues, short,
  BALANCE_TOLERANCE, STALE_BALANCE_DAYS,
  type Wallet, type WalletBalance,
} from './wallets'
import { balanceProviderFor, HAS_CHAIN_PROVIDER, BALANCE_PROVIDER_NAMES } from './balance-providers'

const wallet = (o: Partial<Wallet> = {}): Wallet => ({
  id: 'w1', companyId: 'c1', chain: 'ethereum',
  address: '0x1234567890abcdef1234567890abcdef12345678',
  label: null, active: true, verifiedAt: '2026-01-01T00:00:00Z',
  verificationMethod: 'signed_message',
  ...o,
})

const bal = (o: Partial<WalletBalance> = {}): WalletBalance => ({
  walletId: 'w1', asOfDate: '2026-03-31', units: 12.5, blockHeight: 1000, ...o,
})

const pos = (units: number, o: { companyId?: string; name?: string } = {}) => ({
  companyId: o.companyId ?? 'c1', name: o.name ?? 'Ether', units,
})

describe('balanceAsOf', () => {
  const balances = [
    bal({ asOfDate: '2026-03-28', units: 10 }),
    bal({ asOfDate: '2026-03-31', units: 12.5 }),
    bal({ asOfDate: '2026-04-02', units: 20 }),
  ]

  it('takes the last reading on or before the date, never the latest outright', () => {
    expect(balanceAsOf(balances, 'w1', '2026-03-31')?.units).toBe(12.5)
    expect(balanceAsOf(balances, 'w1', '2026-03-30')?.units).toBe(10)
  })

  it('returns null when nothing precedes the date', () => {
    expect(balanceAsOf(balances, 'w1', '2026-01-01')).toBeNull()
  })

  it('ignores another wallet\'s readings', () => {
    expect(balanceAsOf([bal({ walletId: 'other' })], 'w1', '2026-12-31')).toBeNull()
  })
})

describe('observedByHolding', () => {
  it('sums every active wallet for the holding', () => {
    const wallets = [wallet({ id: 'w1' }), wallet({ id: 'w2' })]
    const balances = [bal({ walletId: 'w1', units: 10 }), bal({ walletId: 'w2', units: 2.5 })]
    expect(observedByHolding(wallets, balances, '2026-03-31').get('c1')?.observedUnits).toBe(12.5)
  })

  it('skips an inactive wallet', () => {
    const wallets = [wallet({ id: 'w1' }), wallet({ id: 'w2', active: false })]
    const balances = [bal({ walletId: 'w1', units: 10 }), bal({ walletId: 'w2', units: 999 })]
    expect(observedByHolding(wallets, balances, '2026-03-31').get('c1')?.observedUnits).toBe(10)
  })

  it('names an unread wallet rather than counting it as zero', () => {
    // Zero would understate the holding and read as a disposal that never happened.
    const wallets = [wallet({ id: 'w1' }), wallet({ id: 'w2' })]
    const got = observedByHolding(wallets, [bal({ walletId: 'w1', units: 10 })], '2026-03-31')
    expect(got.get('c1')?.observedUnits).toBe(10)
    expect(got.get('c1')?.unobserved.map(w => w.id)).toEqual(['w2'])
  })

  it('tracks the oldest contributing reading for staleness', () => {
    const wallets = [wallet({ id: 'w1' }), wallet({ id: 'w2' })]
    const balances = [
      bal({ walletId: 'w1', asOfDate: '2026-03-31' }),
      bal({ walletId: 'w2', asOfDate: '2026-03-02' }),
    ]
    expect(observedByHolding(wallets, balances, '2026-03-31').get('c1')?.oldestAsOf).toBe('2026-03-02')
  })
})

describe('walletVariances', () => {
  it('is silent when the chain and the books agree', () => {
    expect(walletVariances([pos(12.5)], [wallet()], [bal({ units: 12.5 })], '2026-03-31')).toEqual([])
  })

  it('reports an unrecorded receipt', () => {
    const [v] = walletVariances([pos(10)], [wallet()], [bal({ units: 12.5 })], '2026-03-31')
    expect(v).toMatchObject({ observedUnits: 12.5, recordedUnits: 10, delta: 2.5 })
  })

  it('reports an unrecorded disposal', () => {
    const [v] = walletVariances([pos(12.5)], [wallet()], [bal({ units: 10 })], '2026-03-31')
    expect(v.delta).toBe(-2.5)
  })

  it('tolerates last-decimal noise on an 18-decimal quantity', () => {
    const recorded = 12.5
    const observed = recorded * (1 + BALANCE_TOLERANCE / 2)
    expect(walletVariances([pos(recorded)], [wallet()], [bal({ units: observed })], '2026-03-31')).toEqual([])
  })

  it('skips a holding with no wallet at all', () => {
    // Tracking a token by hand is an ordinary position, not a finding.
    expect(walletVariances([pos(12.5, { companyId: 'other' })], [wallet()], [bal()], '2026-03-31')).toEqual([])
  })

  it('reports no variance when nothing has been read, rather than a phantom disposal', () => {
    expect(walletVariances([pos(12.5)], [wallet()], [], '2026-03-31')).toEqual([])
  })

  it('flags any observed balance against a position the books record as zero', () => {
    const [v] = walletVariances([pos(0)], [wallet()], [bal({ units: 5 })], '2026-03-31')
    expect(v.delta).toBe(5)
  })
})

describe('walletCloseIssues', () => {
  it('passes clean on a verified, freshly-read, agreeing wallet', () => {
    const issues = walletCloseIssues([pos(12.5)], [wallet()], [bal({ units: 12.5 })], '2026-03-31')
    expect(issues).toEqual({ blockers: [], warnings: [] })
  })

  it('never blocks — a quantity variance is a decision, not a stop', () => {
    // Transfers between the fund's own wallets, un-triaged airdrops and accruing staking rewards
    // all produce a variance a fund can reasonably close over. Blocking would train people to
    // ignore it.
    const issues = walletCloseIssues([pos(10)], [wallet()], [bal({ units: 12.5 })], '2026-03-31')
    expect(issues.blockers).toEqual([])
    expect(issues.warnings).toHaveLength(1)
  })

  it('states both numbers and the direction', () => {
    const issues = walletCloseIssues([pos(10)], [wallet()], [bal({ units: 12.5 })], '2026-03-31')
    expect(issues.warnings[0]).toContain('12.5')
    expect(issues.warnings[0]).toContain('10')
    expect(issues.warnings[0]).toContain('more on-chain than recorded')
  })

  it('suggests a disposal when the chain holds less', () => {
    const issues = walletCloseIssues([pos(12.5)], [wallet()], [bal({ units: 10 })], '2026-03-31')
    expect(issues.warnings[0]).toContain('fewer on-chain than recorded')
    expect(issues.warnings[0]).toContain('disposal')
  })

  it('warns that an unread wallet leaves the position on the books alone', () => {
    const issues = walletCloseIssues([pos(12.5)], [wallet()], [], '2026-03-31')
    expect(issues.warnings.some(w => w.includes('rests on the books alone'))).toBe(true)
  })

  it('warns on a stale reading — a chain never stops producing blocks', () => {
    const stale = bal({ asOfDate: '2026-03-01', units: 12.5 })
    const issues = walletCloseIssues([pos(12.5)], [wallet()], [stale], '2026-03-31')
    expect(issues.warnings.some(w => w.includes('30 days before'))).toBe(true)
    expect(STALE_BALANCE_DAYS).toBeLessThan(7)
  })

  it('tolerates a weekend without warning', () => {
    const friday = bal({ asOfDate: '2026-03-29', units: 12.5 })
    const issues = walletCloseIssues([pos(12.5)], [wallet()], [friday], '2026-03-31')
    expect(issues.warnings).toEqual([])
  })

  it('warns once per holding about unproven control, not once per address', () => {
    const wallets = [
      wallet({ id: 'w1', verifiedAt: null }),
      wallet({ id: 'w2', verifiedAt: null }),
      wallet({ id: 'w3', verifiedAt: null }),
    ]
    const balances = [
      bal({ walletId: 'w1', units: 4 }), bal({ walletId: 'w2', units: 4 }), bal({ walletId: 'w3', units: 4.5 }),
    ]
    const issues = walletCloseIssues([pos(12.5)], wallets, balances, '2026-03-31')
    const control = issues.warnings.filter(w => w.includes('proof of control'))
    expect(control).toHaveLength(1)
    expect(control[0]).toContain('3 addresses have')
  })

  it('says nothing about control once an address is verified', () => {
    const issues = walletCloseIssues([pos(12.5)], [wallet()], [bal({ units: 12.5 })], '2026-03-31')
    expect(issues.warnings.some(w => w.includes('proof of control'))).toBe(false)
  })

  it('ignores an inactive unverified wallet', () => {
    const issues = walletCloseIssues(
      [pos(12.5)], [wallet(), wallet({ id: 'w2', active: false, verifiedAt: null })],
      [bal({ units: 12.5 })], '2026-03-31',
    )
    expect(issues.warnings).toEqual([])
  })
})

describe('short', () => {
  it('shortens a long address recognisably', () => {
    expect(short('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x123456…5678')
  })
  it('leaves a short one alone', () => {
    expect(short('0xABCD')).toBe('0xABCD')
  })
})

describe('balance provider seam', () => {
  it('falls back to hand entry for an unregistered chain provider', () => {
    expect(balanceProviderFor('alchemy').name).toBe('manual')
    expect(balanceProviderFor(null).name).toBe('manual')
  })

  it('reports that no chain provider is wired up yet', () => {
    expect(HAS_CHAIN_PROVIDER).toBe(BALANCE_PROVIDER_NAMES.some(n => n !== 'manual'))
  })

  it('returns nothing rather than a zero balance', async () => {
    // Zero is a real balance meaning "this address holds nothing" and would read as a disposal.
    const got = await balanceProviderFor('manual').fetch([wallet()], { fundId: 'f' })
    expect(got.size).toBe(0)
  })
})
