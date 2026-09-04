import { describe, expect, it } from 'vitest'
import { splitMessage, twilioSignature, verifyTwilioSignature } from './twilio'

/**
 * The published example from Twilio's webhook-security page: auth token `12345`, this URL and
 * these parameters sign to exactly this string. If the algorithm drifts — key order, delimiter,
 * digest — this is the test that says so, and the webhook is then refusing every real delivery.
 */
const DOCS_URL = 'https://mycompany.com/myapp.php?foo=1&bar=2'
const DOCS_PARAMS = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+12349013030',
  Digits: '1234',
  From: '+12349013030',
  To: '+18005551212',
}
const DOCS_SIGNATURE = '0/KCTR6DLpKmkAf8muzZqo1nDgQ='

describe('twilioSignature', () => {
  it('reproduces the documented example', () => {
    expect(twilioSignature('12345', DOCS_URL, DOCS_PARAMS)).toBe(DOCS_SIGNATURE)
  })

  it('is independent of the order the parameters arrived in', () => {
    const shuffled = Object.fromEntries(Object.entries(DOCS_PARAMS).reverse())
    expect(twilioSignature('12345', DOCS_URL, shuffled)).toBe(DOCS_SIGNATURE)
  })
})

describe('verifyTwilioSignature', () => {
  it('accepts the signature against any of the candidate URLs', () => {
    expect(verifyTwilioSignature('12345', ['http://internal/other', DOCS_URL], DOCS_PARAMS, DOCS_SIGNATURE)).toBe(true)
  })

  it('refuses a tampered body, a wrong token, an absent signature, and the wrong URL', () => {
    expect(verifyTwilioSignature('12345', [DOCS_URL], { ...DOCS_PARAMS, Digits: '9999' }, DOCS_SIGNATURE)).toBe(false)
    expect(verifyTwilioSignature('54321', [DOCS_URL], DOCS_PARAMS, DOCS_SIGNATURE)).toBe(false)
    expect(verifyTwilioSignature('12345', [DOCS_URL], DOCS_PARAMS, '')).toBe(false)
    expect(verifyTwilioSignature('', [DOCS_URL], DOCS_PARAMS, DOCS_SIGNATURE)).toBe(false)
    expect(verifyTwilioSignature('12345', ['https://mycompany.com/myapp.php'], DOCS_PARAMS, DOCS_SIGNATURE)).toBe(false)
  })
})

describe('splitMessage', () => {
  it('leaves a short reply alone and drops an empty one', () => {
    expect(splitMessage('  MOIC is 2.1x.  ')).toEqual(['MOIC is 2.1x.'])
    expect(splitMessage('   ')).toEqual([])
  })

  it('breaks a long reply at a paragraph, keeping every piece under the limit', () => {
    const paragraph = 'Revenue grew 40% quarter over quarter to $1.2M. '.repeat(6).trim()
    const text = [paragraph, paragraph, paragraph].join('\n\n')
    const pieces = splitMessage(text, 400)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(400)
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '))
  })

  it('falls back to a sentence, then a word, then a hard cut', () => {
    const sentences = 'One sentence here. Another sentence there. ' .repeat(20).trim()
    for (const piece of splitMessage(sentences, 100)) {
      expect(piece.length).toBeLessThanOrEqual(100)
      expect(piece.endsWith('.')).toBe(true)
    }
    const unbroken = 'x'.repeat(250)
    expect(splitMessage(unbroken, 100)).toEqual(['x'.repeat(100), 'x'.repeat(100), 'x'.repeat(50)])
  })
})
