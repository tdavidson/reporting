import { describe, expect, it } from 'vitest'
import { buildReportOnlyCsp, generateNonce } from './csp'

/**
 * The strict policy, shipped report-only. These pin what makes it strict and what is deliberately
 * left loose, so a later edit cannot quietly re-admit `'unsafe-inline'` to script-src, or quietly
 * remove `'unsafe-inline'` from style-src and drown the report in React style attributes.
 */

const directive = (csp: string, name: string) =>
  csp.split(';').map(d => d.trim()).find(d => d.startsWith(`${name} `) || d === name) ?? ''

describe('the nonce', () => {
  it('is 128 bits of base64 that Next’s nonce regex accepts', () => {
    const nonce = generateNonce()
    expect(Buffer.from(nonce, 'base64')).toHaveLength(16)
    expect(nonce).toMatch(/^[A-Za-z0-9+/_-]+={0,2}$/)
  })

  it('differs every time — a reused nonce is no nonce', () => {
    const seen = new Set(Array.from({ length: 50 }, generateNonce))
    expect(seen.size).toBe(50)
  })
})

describe('script-src', () => {
  const csp = buildReportOnlyCsp('abc123')
  const script = directive(csp, 'script-src')

  it('carries the nonce and strict-dynamic, and NOT unsafe-inline', () => {
    expect(script).toContain("'nonce-abc123'")
    expect(script).toContain("'strict-dynamic'")
    expect(script).not.toContain("'unsafe-inline'")
  })

  it('leaves unsafe-eval out in production — report-only is how we learn whether anything needs it', () => {
    expect(script).not.toContain("'unsafe-eval'")
  })

  it('admits unsafe-eval in development only, for React Refresh', () => {
    expect(directive(buildReportOnlyCsp('n', { development: true }), 'script-src')).toContain("'unsafe-eval'")
  })

  it('names the same third parties the enforcing policy does, so a report is a new fact', () => {
    for (const host of ['cdn.usefathom.com', 'googletagmanager.com', 'google-analytics.com', 'assets.calendly.com']) {
      expect(script).toContain(host)
    }
  })
})

describe('what is deliberately not strict', () => {
  const csp = buildReportOnlyCsp('n')

  it('keeps unsafe-inline on style-src — React style attributes would otherwise flood the report', () => {
    expect(directive(csp, 'style-src')).toContain("'unsafe-inline'")
  })
})

describe('the rest of the policy', () => {
  const csp = buildReportOnlyCsp('n')

  it('reports to the collection endpoint', () => {
    expect(directive(csp, 'report-uri')).toBe('report-uri /api/csp-report')
  })

  it('adds the two cheap directives the enforcing policy lacks', () => {
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive(csp, 'form-action')).toBe("form-action 'self'")
  })

  it('keeps the protections the enforcing policy already had', () => {
    expect(directive(csp, 'object-src')).toBe("object-src 'none'")
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'")
  })

  it('does not quote the nonce into any directive other than script-src', () => {
    const others = csp.split(';').filter(d => !d.trim().startsWith('script-src'))
    expect(others.join(';')).not.toContain('nonce-')
  })
})
