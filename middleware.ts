import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Always call getUser() to refresh the session token.
  // Do not add logic between createServerClient and getUser().
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isAuthRoute = pathname.startsWith('/auth')
  const isApiRoute = pathname.startsWith('/api')

  // Marketing site routes require both env vars to be set
  const marketingEnabled =
    process.env.NEXT_PUBLIC_ENABLE_MARKETING_SITE === 'true' &&
    !!process.env.MARKETING_DEPLOYMENT_KEY

  const isMarketingRoute = pathname === '/' || pathname === '/license' || pathname === '/demo' || pathname === '/contact' || pathname === '/terms' || pathname === '/privacy' || pathname === '/pricing' || pathname.endsWith('-explainer')
  const isPublicRoute = marketingEnabled && isMarketingRoute

  const isSetupRoute = pathname === '/setup' && process.env.ENABLE_SETUP_PAGE === 'true'

  // Unauthenticated users can only access /auth, API, public, and setup routes
  if (!user && !isAuthRoute && !isApiRoute && !isPublicRoute && !isSetupRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    return NextResponse.redirect(url)
  }

  // Enforce MFA: redirect to verify page if user has enrolled TOTP but hasn't completed AAL2
  if (user && !isAuthRoute && !isPublicRoute) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      if (isApiRoute) {
        return NextResponse.json({ error: 'MFA verification required' }, { status: 403 })
      }
      const url = request.nextUrl.clone()
      url.pathname = '/auth/mfa-verify'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Exclude: Next.js internals, static assets, inbound email webhook, and cron endpoints.
    // Cron routes use their own Bearer token auth and must not pass through the Edge middleware
    // layer (which requires a Supabase session and would block unauthenticated GitHub Actions calls).
    '/((?!_next/static|_next/image|favicon.ico|api/inbound-email|api/bacen/scraper|api/vc-market/scraper|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
