import { describe, it, expect } from 'vitest'
import { matchTransaction, descriptionNamesPartner, type OpenBalance } from './bank-auto-match'

const bal = (lpEntityId: string, name: string, amount: number): OpenBalance => ({ lpEntityId, name, amount })

describe('descriptionNamesPartner', () => {
  it('finds a partner named in a wire description', () => {
    expect(descriptionNamesPartner('WIRED FUNDS SENT BENE: Amy Segal ACCT: XXXXXX9476', 'Amy Segal')).toBe(true)
  })

  it('survives the bank truncating the last token', () => {
    // Real shape: the bank cuts "GmbH" to "Gmb".
    expect(descriptionNamesPartner('WIRED FUNDS SENT BENE: Peter Jungen Holding Gmb ACCT: X', 'Peter Jungen Holding GmbH')).toBe(true)
  })

  it('ignores case and punctuation', () => {
    expect(descriptionNamesPartner('wired funds sent bene: jaffe family limited partnership', 'Jaffe Family Limited Partnership')).toBe(true)
    expect(descriptionNamesPartner('SENT TO: M RIDGWAY BARKER', 'M. Ridgway Barker')).toBe(true)
  })

  it('does NOT match on a shared first name alone', () => {
    // The failure that would move one partner's money into another's account.
    expect(descriptionNamesPartner('WIRED FUNDS SENT BENE: Michael J. Alpert', 'Michael Rueda')).toBe(false)
  })

  it('does not match an unrelated description', () => {
    expect(descriptionNamesPartner('FEDERATED HERMES GOVT OBL PRM', 'Amy Segal')).toBe(false)
  })
})

describe('matchTransaction', () => {
  it('matches on amount when only one partner fits', () => {
    const r = matchTransaction(-11_500, 'ANY DESCRIPTION', [bal('a', 'Peter G. Duncan', 11_500), bal('b', 'Amy Segal', 17_250)])
    expect(r).toEqual({ kind: 'matched', lpEntityId: 'a', name: 'Peter G. Duncan', by: 'amount' })
  })

  it('uses the description to break a tie between identical amounts', () => {
    // Four partners at the same figure is the real case, not a contrived one.
    const open = [
      bal('a', 'Geri Kirilova', 5_750), bal('b', 'Michael Rueda', 5_750),
      bal('c', 'Padma Rao', 5_750), bal('d', 'M. Ridgway Barker', 5_750),
    ]
    const r = matchTransaction(-5_750, 'WIRED FUNDS SENT BENE: Michael Rueda ACCT: XXXXXXX0178', open)
    expect(r).toEqual({ kind: 'matched', lpEntityId: 'b', name: 'Michael Rueda', by: 'amount+name' })
  })

  it('REFUSES to guess when the amount ties and no name appears', () => {
    const open = [bal('a', 'Geri Kirilova', 5_750), bal('b', 'Michael Rueda', 5_750)]
    const r = matchTransaction(-5_750, 'OUTGOING WIRE 8837465', open)
    expect(r.kind).toBe('ambiguous')
    expect(r.kind === 'ambiguous' && r.candidates).toHaveLength(2)
  })

  it('refuses when the description names two of the tied partners', () => {
    const open = [bal('a', 'Amy Segal', 5_750), bal('b', 'Michael Rueda', 5_750)]
    const r = matchTransaction(-5_750, 'WIRE TO Amy Segal AND Michael Rueda', open)
    expect(r.kind).toBe('ambiguous')
  })

  it('returns none when nothing is owed at that amount', () => {
    expect(matchTransaction(-999, 'WIRED FUNDS SENT BENE: Amy Segal', [bal('a', 'Amy Segal', 5_750)]).kind).toBe('none')
  })

  it('works off the absolute amount, so direction is the caller’s concern', () => {
    const open = [bal('a', 'Amy Segal', 17_250)]
    expect(matchTransaction(17_250, null, open).kind).toBe('matched')
    expect(matchTransaction(-17_250, null, open).kind).toBe('matched')
  })

  it('ignores a zero-value transaction', () => {
    expect(matchTransaction(0, 'ANYTHING', [bal('a', 'Amy Segal', 0)]).kind).toBe('none')
  })

  it('tolerates sub-cent drift but not a real difference', () => {
    const open = [bal('a', 'Amy Segal', 17_250)]
    expect(matchTransaction(-17_250.004, null, open).kind).toBe('matched')
    expect(matchTransaction(-17_251, null, open).kind).toBe('none')
  })
})
