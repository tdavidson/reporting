import { describe, it, expect } from 'vitest'
import { parseAddressList } from './email'

describe('parseAddressList', () => {
  it('returns undefined for empty input', () => {
    expect(parseAddressList(undefined)).toEqual({ value: undefined })
    expect(parseAddressList('')).toEqual({ value: undefined })
    expect(parseAddressList('   ')).toEqual({ value: undefined })
  })

  it('normalizes comma- and semicolon-separated lists', () => {
    expect(parseAddressList('a@b.com,  c@d.com ; e@f.com')).toEqual({
      value: 'a@b.com, c@d.com, e@f.com',
    })
  })

  it('accepts display-name form', () => {
    expect(parseAddressList('Ada Lovelace <ada@example.com>')).toEqual({
      value: 'Ada Lovelace <ada@example.com>',
    })
  })

  it('reports the first entry that is not an address', () => {
    expect(parseAddressList('a@b.com, not-an-email')).toEqual({ invalid: 'not-an-email' })
    expect(parseAddressList('Ada <ada@>')).toEqual({ invalid: 'Ada <ada@>' })
  })

  // A Cc/Bcc value reaches a raw MIME header on the Gmail path, so a newline in it
  // would otherwise inject headers of the sender's choosing.
  it('strips CR/LF rather than letting it through', () => {
    expect(parseAddressList('a@b.com\r\nBcc: attacker@evil.com')).toEqual({
      invalid: 'a@b.com Bcc: attacker@evil.com',
    })
    expect(parseAddressList('a@b.com,\n c@d.com')).toEqual({ value: 'a@b.com, c@d.com' })
  })
})
