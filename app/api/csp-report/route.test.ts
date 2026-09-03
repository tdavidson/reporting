import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * An open, unauthenticated POST endpoint on the internet — so the tests are about what it refuses
 * and what it declines to log, as much as about parsing.
 */

const mocks = vi.hoisted(() => ({ rateLimit: vi.fn() }))
vi.mock('@/lib/rate-limit', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: mocks.rateLimit,
}))

import { POST, parseCspReports } from './route'

const post = (body: string, type = 'application/csp-report') =>
  POST(new Request('https://reporting.test/api/csp-report', {
    method: 'POST',
    headers: { 'Content-Type': type, 'Content-Length': String(body.length) },
    body,
  }))

const legacy = {
  'csp-report': {
    'document-uri': 'https://reporting.test/companies/abc',
    'violated-directive': 'script-src',
    'effective-directive': 'script-src',
    'blocked-uri': 'inline',
    'source-file': 'https://reporting.test/companies/abc',
    'line-number': 42,
    'script-sample': 'window.dataLayer=window.dataLayer||[]',
    disposition: 'report',
    'original-policy': 'THIS IS THE WHOLE POLICY AND SHOULD NOT BE LOGGED',
  },
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  mocks.rateLimit.mockResolvedValue(null)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('parsing', () => {
  it('reads the legacy report-uri object', () => {
    const [v] = parseCspReports(legacy)
    expect(v).toMatchObject({
      documentUri: 'https://reporting.test/companies/abc',
      violatedDirective: 'script-src',
      blockedUri: 'inline',
      lineNumber: 42,
      disposition: 'report',
    })
  })

  it('reads the Reporting API array, skipping entries that are not CSP violations', () => {
    const reports = parseCspReports([
      { type: 'deprecation', body: {} },
      { type: 'csp-violation', body: { documentURL: 'https://reporting.test/x', effectiveDirective: 'script-src', blockedURL: 'eval', disposition: 'report' } },
    ])
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ documentUri: 'https://reporting.test/x', blockedUri: 'eval' })
  })

  it('returns nothing for shapes it does not recognise, rather than logging them', () => {
    expect(parseCspReports('a string')).toEqual([])
    expect(parseCspReports(null)).toEqual([])
    expect(parseCspReports({ unrelated: true })).toEqual([])
  })

  it('clips every string field, so a hostile report cannot write an essay into the logs', () => {
    const long = { 'csp-report': { 'document-uri': 'x'.repeat(5000) } }
    expect(parseCspReports(long)[0].documentUri!.length).toBe(300)
  })
})

describe('POST /api/csp-report', () => {
  it('logs one greppable line per violation and answers 204', async () => {
    const response = await post(JSON.stringify(legacy))
    expect(response.status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(1)
    const [tag, line] = warn.mock.calls[0]
    expect(tag).toBe('[csp-report]')
    expect(JSON.parse(line as string)).toMatchObject({ violatedDirective: 'script-src', blockedUri: 'inline' })
  })

  it('never logs the request body verbatim — only the allowlisted fields', async () => {
    await post(JSON.stringify(legacy))
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SHOULD NOT BE LOGGED')
  })

  it('rate-limits, because anyone can call it', async () => {
    mocks.rateLimit.mockResolvedValue(new Response(null, { status: 429 }))
    expect((await post(JSON.stringify(legacy))).status).toBe(429)
    expect(warn).not.toHaveBeenCalled()
  })

  it('refuses an oversized body without reading it', async () => {
    const response = await POST(new Request('https://reporting.test/api/csp-report', {
      method: 'POST',
      headers: { 'Content-Length': String(1024 * 1024) },
      body: 'x',
    }))
    expect(response.status).toBe(413)
  })

  it('refuses a body that is not JSON', async () => {
    expect((await post('not json')).status).toBe(400)
    expect(warn).not.toHaveBeenCalled()
  })

  it('answers 204 for a well-formed report that contains no violation', async () => {
    expect((await post(JSON.stringify({ unrelated: true }))).status).toBe(204)
    expect(warn).not.toHaveBeenCalled()
  })
})
