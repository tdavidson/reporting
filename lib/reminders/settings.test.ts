import { describe, it, expect } from 'vitest'
import { parseRecipients } from './settings'

describe('parseRecipients', () => {
  it('splits and trims a comma/semicolon list', () => {
    expect(parseRecipients('a@x.com, b@y.com; Ops <ops@z.com>')).toEqual({ value: ['a@x.com', 'b@y.com', 'Ops <ops@z.com>'] })
  })
  it('treats empty as "fall back to admins"', () => {
    expect(parseRecipients('  ')).toEqual({ value: [] })
    expect(parseRecipients(undefined)).toEqual({ value: [] })
  })
  it('reports the first invalid entry', () => {
    expect(parseRecipients('a@x.com, nope')).toEqual({ invalid: 'nope' })
  })
  it('caps the list', () => {
    const many = Array.from({ length: 21 }, (_, i) => `u${i}@x.com`).join(',')
    expect(parseRecipients(many)).toEqual({ invalid: 'more than 20 recipients' })
  })
})
