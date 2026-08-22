import type { Wallet } from '../wallets'

// ---------------------------------------------------------------------------
// Where wallet balances come from.
//
// The same seam as lib/portfolio/quote-providers, for the same reason and with the same
// deliberate gap: NO CHAIN PROVIDER IS WIRED UP. Balances are read and entered by hand today,
// which is workable for a few addresses and costs nothing.
//
// ADDING ONE is a new file and a line in PROVIDERS below. Candidates: Alchemy, Etherscan and
// its per-chain siblings, Covalent, or a node the fund runs. All of them need an API key, which
// follows the repo's existing pattern — a `*_encrypted` column on `fund_settings` under the
// fund DEK, as the Claude and Resend keys do.
//
// TWO RULES an adapter must respect, both of which look like details and are not:
//
//   1. CONFIRMATIONS. A balance read at the chain head can be reorganised out of existence.
//      An adapter must read at a confirmed depth and report the `blockHeight` it read at, so
//      the number can be reproduced later. A balance nobody can re-derive is not evidence.
//
//   2. QUANTITIES ARE NOT MONEY. Token balances are integers in the token's base unit and
//      routinely have 18 decimals. Convert with exact integer arithmetic and hand back a
//      `numeric`-safe value — a float conversion of a wei balance loses precision silently,
//      and JavaScript's Number cannot hold one.
// ---------------------------------------------------------------------------

export interface BalanceResult {
  /** Units of the asset, already scaled out of the chain's base unit. */
  units: number
  /** The date this balance describes. */
  asOfDate: string
  /** Block the balance was read at, so it can be re-derived. */
  blockHeight?: number | null
}

export interface BalanceProviderContext {
  fundId: string
  /** Whatever a registered adapter needs to authenticate. See the note above. */
  credentials?: Record<string, unknown>
}

export interface BalanceProvider {
  name: string
  /**
   * Balances for the given wallets, keyed by wallet id. Batched because every chain API is
   * rate-limited per key, and a per-wallet interface would make a fund with a dozen addresses
   * do a dozen round trips.
   *
   * A wallet the provider cannot read is ABSENT from the map — never zero. Zero is a real
   * balance meaning "this address holds nothing", and it would read as a full disposal.
   */
  fetch(wallets: Wallet[], ctx: BalanceProviderContext): Promise<Map<string, BalanceResult>>
}

/** Balances read and entered by hand — the only provider today, and a real one. */
const manualProvider: BalanceProvider = {
  name: 'manual',
  async fetch() { return new Map<string, BalanceResult>() },
}

const PROVIDERS: Record<string, BalanceProvider> = {
  manual: manualProvider,
  // Register a chain adapter here. See the note above for the contract.
}

export const BALANCE_PROVIDER_NAMES = Object.keys(PROVIDERS)

/** True once something other than hand entry is registered. */
export const HAS_CHAIN_PROVIDER = BALANCE_PROVIDER_NAMES.some(n => n !== 'manual')

export function balanceProviderFor(name: string | null | undefined): BalanceProvider {
  return PROVIDERS[name ?? 'manual'] ?? manualProvider
}
