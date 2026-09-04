import { describe, it, expect } from 'vitest'
import { toCsv, csvCell } from './csv'

describe('toCsv', () => {
  it('quotes only what needs quoting and doubles embedded quotes', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('has, comma')).toBe('"has, comma"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
  })

  it('writes numbers to two decimals with no thousands separator', () => {
    expect(csvCell(1234567.891)).toBe('1234567.89')
    expect(csvCell(0)).toBe('0.00')
    expect(csvCell(-5)).toBe('-5.00')
    expect(csvCell(NaN)).toBe('')
  })

  it('writes null and undefined as empty cells and ends with a newline', () => {
    expect(toCsv([['a', null, undefined, 'b'], [1, 2]])).toBe('a,,,b\n1.00,2.00\n')
  })
})
