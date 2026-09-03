/**
 * What may be registered as an OAuth redirect URI.
 *
 * Registration is open by necessity — RFC 7591 clients have no credential yet — so this validator
 * is most of what stops the endpoint from becoming an open-redirect factory. It runs once, at
 * registration; `redirectUriAllowed` then exact-matches the stored string at both /authorize and
 * /token, and that verbatim comparison must never be loosened to compensate for anything here.
 *
 * NATIVE CALLBACKS. Until now this accepted only `https:` and loopback `http:`, which meant no iOS
 * or Android app could register at all: `ASWebAuthenticationSession` hands control back through a
 * custom scheme the app claims. The plan requires supporting that without "broadly accepting
 * arbitrary URI schemes", so the rule is a SHAPE rather than a list:
 *
 *   a custom scheme must be reverse-DNS — at least one dot, e.g. `com.hemrock.reporting:`
 *
 * That single requirement does the work an explicit denylist would. Every scheme that makes a
 * redirect dangerous is a bare word: `javascript:`, `data:`, `file:`, `blob:`, `vbscript:`,
 * `about:`, `intent:`, `chrome-extension:`, `ws:`, `mailto:`. None of them contains a dot, so none
 * of them can be registered, and no list has to be kept current as new ones are invented.
 *
 * It also matches what RFC 8252 §7.1 asks of native apps — a scheme derived from a domain the app
 * controls — which is the same property that makes collisions between apps unlikely.
 *
 * WHAT THIS CANNOT DO. A custom scheme is claimed on a first-come basis by the operating system,
 * so a hostile app installed on the same device can register the same scheme and receive the
 * authorization code (RFC 8252 §8.6). PKCE is what makes that survivable: the code is useless
 * without the verifier, which never leaves the legitimate app. HTTPS universal links avoid the
 * problem entirely and remain the better choice where a fork can serve a well-known file.
 */

/** Long enough for any real callback; short enough that the column is not an essay store. */
const MAX_URI_LENGTH = 2048

/** `scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )` (RFC 3986 §3.1), narrowed to reverse-DNS. */
const REVERSE_DNS_SCHEME = /^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+$/

export type RedirectUriVerdict = { ok: true } | { ok: false; reason: string }

export function validateRedirectUri(raw: unknown): RedirectUriVerdict {
  if (typeof raw !== 'string') return { ok: false, reason: 'redirect_uris must be strings' }
  if (raw.length > MAX_URI_LENGTH) return { ok: false, reason: 'redirect_uri is too long' }

  // Control characters and whitespace are stripped or re-interpreted differently by different
  // parsers, which is how one component's idea of a URI stops matching another's.
  if (/[\x00-\x20\x7f]/.test(raw)) {
    return { ok: false, reason: 'redirect_uri must not contain whitespace or control characters' }
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: `Not a valid URL: ${raw}` }
  }

  // RFC 6749 §3.1.2: a redirect endpoint MUST NOT include a fragment. The authorization response
  // appends its own query, and a fragment here changes where the code lands.
  if (parsed.hash) return { ok: false, reason: 'redirect_uri must not contain a fragment' }

  // `https://user:pass@real.example.com@evil.example.com/` reads as the real host to a person and
  // resolves to the attacker's. Nothing legitimate puts credentials in a callback.
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'redirect_uri must not contain userinfo' }
  }

  const scheme = parsed.protocol.replace(/:$/, '')

  // No host check for https: the WHATWG parser cannot produce a host-less special-scheme URL —
  // `https:///cb` normalizes to `https://cb/` — so the branch would be unreachable. A nonsense host
  // is harmless anyway, because the stored string is exact-matched at /authorize and /token and a
  // client that registered gibberish simply never matches.
  if (scheme === 'https') return { ok: true }

  if (scheme === 'http') {
    // Loopback only, for desktop and CLI clients. Plain http to a remote host puts the code on the
    // wire in clear text.
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
    return loopback
      ? { ok: true }
      : { ok: false, reason: 'http redirect_uri is only allowed on loopback' }
  }

  if (REVERSE_DNS_SCHEME.test(scheme)) return { ok: true }

  return {
    ok: false,
    reason: 'redirect_uri must be https, http on loopback, or a reverse-DNS native scheme (e.g. com.example.app:)',
  }
}
