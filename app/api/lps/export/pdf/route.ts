import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import puppeteer from 'puppeteer-core'
import JSZip from 'jszip'

export const maxDuration = 120 // Allow up to 2 minutes for large batches

/**
 * Resolve the Chrome executable path and launch args.
 * - On Vercel / AWS Lambda: use @sparticuz/chromium (Linux binary)
 * - Locally on macOS: use the system Chrome installation
 */
async function getChromeConfig(): Promise<{ executablePath: string; args: string[] }> {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL) {
    // Dynamic import so the ~50 MB binary isn't loaded in local dev
    const chromium = (await import('@sparticuz/chromium')).default
    return {
      executablePath: await chromium.executablePath(),
      args: chromium.args,
    }
  }

  // Local development — find Chrome on macOS / Linux / Windows
  const fs = await import('fs')
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]
  const found = candidates.find(p => fs.existsSync(p))
  if (!found) throw new Error('Chrome not found locally. Install Google Chrome or set CHROME_EXECUTABLE_PATH.')

  return {
    executablePath: process.env.CHROME_EXECUTABLE_PATH || found,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 403 })

  const body = await req.json()
  const { snapshotId, investorIds, excludedGroups, snapshotName } = body as {
    snapshotId: string
    investorIds: string[]
    excludedGroups: string[]
    snapshotName: string
  }

  // --- Input validation ---
  if (!snapshotId || !Array.isArray(investorIds) || investorIds.length === 0) {
    return NextResponse.json({ error: 'snapshotId and investorIds required' }, { status: 400 })
  }

  if (investorIds.length > 100) {
    return NextResponse.json({ error: 'Maximum 100 investors per batch' }, { status: 400 })
  }

  // Validate UUIDs to prevent SSRF via path traversal in Puppeteer URLs
  if (!UUID_RE.test(snapshotId)) {
    return NextResponse.json({ error: 'Invalid snapshotId' }, { status: 400 })
  }
  if (!investorIds.every(id => UUID_RE.test(id))) {
    return NextResponse.json({ error: 'Invalid investorId' }, { status: 400 })
  }

  // Sanitize excludedGroups — strip control characters, cap length
  const safeExcludedGroups = (Array.isArray(excludedGroups) ? excludedGroups : [])
    .map(g => String(g).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200))
    .filter(Boolean)
    .slice(0, 50)

  // Verify the snapshot belongs to the user's fund
  const { data: snapshot } = await admin
    .from('lp_snapshots')
    .select('id')
    .eq('id', snapshotId)
    .eq('fund_id', membership.fund_id)
    .maybeSingle()

  if (!snapshot) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })

  // Verify all investorIds belong to the user's fund
  const { data: investors } = await admin
    .from('lp_investors')
    .select('id, name')
    .eq('fund_id', membership.fund_id)
    .in('id', investorIds)

  const verifiedInvestors = investors ?? []
  const verifiedIds = new Set(verifiedInvestors.map(i => i.id))
  const unauthorizedIds = investorIds.filter(id => !verifiedIds.has(id))
  if (unauthorizedIds.length > 0) {
    return NextResponse.json({ error: 'One or more investors not found in your fund' }, { status: 403 })
  }

  const investorNameMap = new Map(verifiedInvestors.map(i => [i.id, i.name]))

  // Resolve the app origin — must use NEXT_PUBLIC_APP_URL to prevent Host header SSRF
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_APP_URL not configured — PDF export unavailable' },
      { status: 500 }
    )
  }

  // Forward the user's cookies so Puppeteer has an authenticated session
  const cookieHeader = req.headers.get('cookie') ?? ''
  const appDomain = new URL(appUrl).hostname

  // Launch headless Chrome
  const chrome = await getChromeConfig()
  const browser = await puppeteer.launch({
    args: chrome.args,
    defaultViewport: { width: 1024, height: 1400 },
    executablePath: chrome.executablePath,
    headless: true,
  })

  try {
    // Parse cookies once (shared across all pages)
    const parsedCookies = cookieHeader.split(';').map(c => {
      const [name, ...rest] = c.trim().split('=')
      return {
        name: name,
        value: rest.join('='),
        domain: appDomain,
        path: '/',
      }
    }).filter(c => c.name && c.value)

    const zip = new JSZip()

    for (const investorId of investorIds) {
      const page = await browser.newPage()

      if (parsedCookies.length > 0) {
        await page.setCookie(...parsedCookies)
      }

      // Build URL — IDs are validated UUIDs, safe to interpolate
      let url = `${appUrl}/lps/${snapshotId}/${investorId}`
      if (safeExcludedGroups.length > 0) {
        url += `?exclude=${encodeURIComponent(safeExcludedGroups.join(','))}`
      }

      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })

      // Wait for content to render (the page shows a loading spinner first)
      await page.waitForSelector('.report-content', { timeout: 15000 })

      const pdfBuffer = await page.pdf({
        format: 'letter',
        margin: { top: '0.5in', right: '0.6in', bottom: '0.5in', left: '0.6in' },
        printBackground: true,
      })

      const investorName = investorNameMap.get(investorId) ?? 'Investor'
      const safeName = investorName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Investor'
      zip.file(`${safeName} - ${(snapshotName || 'Report').replace(/[^a-zA-Z0-9 _-]/g, '').trim()}.pdf`, pdfBuffer)

      await page.close()
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

    // Sanitize filename for Content-Disposition header (prevent header injection)
    const safeZipName = (snapshotName || 'LP Reports').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'LP Reports'

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeZipName} - Individual PDFs.zip"`,
      },
    })
  } finally {
    await browser.close()
  }
}
