import { NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

/**
 * Where browsers POST violations of the report-only CSP (lib/security/csp.ts).
 *
 * This is the whole point of shipping the strict policy report-only: a week of these tells you
 * exactly what the enforcing version would have broken, page by page, before it breaks anything.
 * Read them with `grep '\\[csp-report\\]'` in the function logs.
 *
 * Unauthenticated by necessity — the browser sends these on its own, with no credential of ours
 * — and therefore an open POST endpoint on the internet. So: rate-limited per platform-verified IP,
 * body capped, only the fields that identify a violation are logged, and never the request body
 * verbatim. What is logged is a line per violation, not a table, because these are meant to be
 * read for a week and then to stop arriving.
 *
 * Two wire formats: the legacy `application/csp-report` object (`{ "csp-report": {…} }`, from
 * `report-uri`) and the Reporting API's `application/reports+json` array. Both are accepted so the
 * policy can move from `report-uri` to `report-to` without a change here.
 */
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 16 * 1024
const MAX_FIELD = 300

interface Violation {
  documentUri: string | null
  violatedDirective: string | null
  effectiveDirective: string | null
  blockedUri: string | null
  sourceFile: string | null
  lineNumber: number | null
  sample: string | null
  disposition: string | null
}

function clip(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, MAX_FIELD) : null
}

function fromLegacy(body: Record<string, unknown>): Violation | null {
  const r = body['csp-report']
  if (!r || typeof r !== 'object') return null
  const v = r as Record<string, unknown>
  return {
    documentUri: clip(v['document-uri']),
    violatedDirective: clip(v['violated-directive']),
    effectiveDirective: clip(v['effective-directive']),
    blockedUri: clip(v['blocked-uri']),
    sourceFile: clip(v['source-file']),
    lineNumber: typeof v['line-number'] === 'number' ? v['line-number'] : null,
    sample: clip(v['script-sample']),
    disposition: clip(v['disposition']),
  }
}

function fromReportingApi(entry: Record<string, unknown>): Violation | null {
  if (entry.type !== 'csp-violation' || !entry.body || typeof entry.body !== 'object') return null
  const v = entry.body as Record<string, unknown>
  return {
    documentUri: clip(v.documentURL),
    violatedDirective: clip(v.violatedDirective) ?? clip(v.effectiveDirective),
    effectiveDirective: clip(v.effectiveDirective),
    blockedUri: clip(v.blockedURL),
    sourceFile: clip(v.sourceFile),
    lineNumber: typeof v.lineNumber === 'number' ? v.lineNumber : null,
    sample: clip(v.sample),
    disposition: clip(v.disposition),
  }
}

export function parseCspReports(body: unknown): Violation[] {
  if (Array.isArray(body)) {
    return body
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map(fromReportingApi)
      .filter((v): v is Violation => v !== null)
  }
  if (body && typeof body === 'object') {
    const one = fromLegacy(body as Record<string, unknown>)
    return one ? [one] : []
  }
  return []
}

export async function POST(req: Request) {
  // Ten reports a minute per IP is generous for a real browser hitting one bad page and useless
  // as a flood. A caller who forges the platform IP header cannot, because it is not read.
  const limited = await rateLimit({ key: `csp-report:${getClientIp(req)}`, limit: 10, windowSeconds: 60 })
  if (limited) return limited

  const length = Number(req.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 })

  const text = await req.text().catch(() => '')
  if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 })

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  for (const v of parseCspReports(body)) {
    // One line, greppable, and nothing from the request that was not one of these fields.
    console.warn('[csp-report]', JSON.stringify(v))
  }

  // 204 whatever was reported: the browser is not waiting for an answer, and a non-2xx makes some
  // of them retry.
  return new NextResponse(null, { status: 204 })
}
