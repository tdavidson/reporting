import { describe, expect, it } from 'vitest'
import { validateRedirectUri } from './redirect-uri'

/**
 * The registration endpoint is open by necessity, so this validator is most of what keeps it from
 * becoming an open-redirect factory. It is also the reason no iOS app could register until now:
 * only `https:` and loopback `http:` were accepted, and `ASWebAuthenticationSession` hands control
 * back through a custom scheme.
 *
 * The rule for native callbacks is a SHAPE — reverse-DNS, at least one dot — chosen because every
 * scheme that makes a redirect dangerous is a bare word with no dot in it. The tests below are as
 * much about that claim as about the parsing.
 */

const ok = (uri: string) => expect(validateRedirectUri(uri), uri).toEqual({ ok: true })
const no = (uri: string) => expect(validateRedirectUri(uri).ok, uri).toBe(false)

describe('web callbacks', () => {
  it('accepts https anywhere', () => {
    ok('https://app.example.com/oauth/callback')
    ok('https://app.example.com:8443/cb?tenant=a')
  })

  it('accepts http only on loopback, for desktop and CLI clients', () => {
    ok('http://localhost:8080/callback')
    ok('http://127.0.0.1:1455/callback')
    ok('http://[::1]:1455/callback')
    no('http://app.example.com/callback')
    no('http://192.168.1.10/callback')
    // A hostname that merely contains "localhost" is not loopback.
    no('http://localhost.evil.com/callback')
  })

  it('cannot be given a host-less https URI — the parser normalizes one away', () => {
    // `https:///callback` becomes `https://callback/`: a valid URL whose host is "callback".
    // Accepting it is harmless, because the RAW string is what gets stored and exact-matched, so a
    // client that registers gibberish simply never matches its own callback.
    expect(new URL('https:///callback').hostname).toBe('callback')
    ok('https:///callback')
  })
})

describe('native callbacks', () => {
  it('accepts a reverse-DNS scheme, in each form a native app uses', () => {
    ok('com.hemrock.reporting://oauth')
    ok('com.hemrock.reporting:/oauth')
    ok('com.hemrock.reporting:oauth')
  })

  it('accepts a fork’s own scheme without a source change', () => {
    // The whole point of the shape rule: nothing here names Hemrock.
    ok('io.acmecapital.reporting://oauth')
    ok('com.example.some-fund.reporting://cb')
  })

  it('refuses a bare scheme with no dot, which is what every dangerous one is', () => {
    for (const uri of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'blob:https://example.com/uuid',
      'about:blank',
      'intent://scan/#Intent;scheme=zxing;end',
      'ws://example.com/socket',
      'mailto:attacker@example.com',
      'myapp://callback',
    ]) no(uri)
  })

  it('is not fooled by a dotted scheme that merely starts with a dangerous word', () => {
    // `javascript.evil:` is a different scheme from `javascript:` — it cannot execute anything.
    // Recorded so the dot rule is understood as a shape, not as prefix matching.
    ok('javascript.evil.example://cb')
  })

  it('refuses a scheme that is not a legal URI scheme at all', () => {
    no('1com.example://cb')   // must start with a letter
    no('com_example.app://cb') // underscore is not in the scheme grammar
  })
})

describe('rules that apply to every scheme', () => {
  it('refuses a fragment — RFC 6749 §3.1.2', () => {
    no('https://app.example.com/cb#fragment')
    no('com.hemrock.reporting://oauth#x')
  })

  it('refuses userinfo, which makes one host read as another', () => {
    // Reads as real.example.com to a person; resolves to evil.example.com.
    no('https://real.example.com@evil.example.com/cb')
    no('https://user:pass@app.example.com/cb')
  })

  it('refuses whitespace and control characters, which parsers disagree about', () => {
    no('https://app.example.com/cb\n')
    no('https://app.example.com/ cb')
    no('https://app.example.com/cb\x00')
    no('https://app.example.com/cb\t')
  })

  it('refuses a non-string, a non-URL, and an over-long URI', () => {
    expect(validateRedirectUri(undefined).ok).toBe(false)
    expect(validateRedirectUri(42).ok).toBe(false)
    no('not a url')
    no('https://app.example.com/' + 'x'.repeat(2100))
  })
})

describe('the authorization response still round-trips', () => {
  it('appends code and state to every accepted form without mangling it', () => {
    // `withParams` in app/api/oauth/consent/route.ts does exactly this. A custom scheme that did
    // not survive `new URL(...).searchParams` would register fine and then break at the last step.
    for (const uri of [
      'com.hemrock.reporting://oauth',
      'com.hemrock.reporting:/oauth',
      'com.hemrock.reporting:oauth',
      'https://app.example.com/cb',
      'http://127.0.0.1:8080/cb',
    ]) {
      const url = new URL(uri)
      url.searchParams.set('code', 'abc')
      url.searchParams.set('state', 'xyz')
      expect(url.toString(), uri).toContain('code=abc')
      expect(url.toString(), uri).toContain('state=xyz')
      expect(url.toString(), uri).toContain(new URL(uri).protocol)
    }
  })
})
