import { describe, expect, it } from 'vitest'
import { hashVerificationCode, mintVerificationCode, verificationCodeMatches } from './verification'

describe('verification codes', () => {
  it('mints six digits, zero-padded', () => {
    for (let i = 0; i < 50; i++) expect(mintVerificationCode()).toMatch(/^\d{6}$/)
  })

  it('binds the hash to the row it was minted for', () => {
    const hash = hashVerificationCode('123456', 'row-a')
    expect(verificationCodeMatches('123456', 'row-a', hash)).toBe(true)
    expect(verificationCodeMatches(' 123456 ', 'row-a', hash)).toBe(true)
    // The same code presented against another row is a replay, not a match.
    expect(verificationCodeMatches('123456', 'row-b', hash)).toBe(false)
    expect(verificationCodeMatches('123457', 'row-a', hash)).toBe(false)
    expect(verificationCodeMatches('123456', 'row-a', null)).toBe(false)
    expect(verificationCodeMatches('12345', 'row-a', hash)).toBe(false)
  })
})
