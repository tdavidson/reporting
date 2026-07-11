import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Serves the reporting-cli source (a single zero-dependency Node script) from
// its one canonical location, cli/bin/reporting.mjs — no duplicated copy to keep
// in sync. The installer at /install.sh downloads this. The file is force-
// included in the serverless bundle via next.config.mjs outputFileTracingIncludes
// (same mechanism the memo-agent default schemas use).

export function GET() {
  try {
    const src = readFileSync(join(process.cwd(), 'cli', 'bin', 'reporting.mjs'), 'utf8')
    return new NextResponse(src, {
      status: 200,
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    })
  } catch {
    return NextResponse.json({ error: 'CLI source is unavailable in this deployment.' }, { status: 500 })
  }
}
