import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { registerClient } from '@/lib/oauth/store'
import { validateRedirectUri } from '@/lib/oauth/redirect-uri'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

/**
 * RFC 7591 — Dynamic Client Registration.
 *
 * Claude's custom-connector flow calls this FIRST, unauthenticated, to obtain a
 * client_id. This endpoint failing (or not existing, which was the case before)
 * is exactly the "Couldn't register with the sign-in service" error.
 *
 * IS AN OPEN REGISTRATION ENDPOINT SAFE? Yes, and it has to be open — the client
 * has no credential to present yet, so the spec requires it. A client_id grants
 * nothing on its own: it cannot read a byte until a real human signs in at
 * /oauth/authorize and consents, and the token that results is bound to THAT
 * person's fund and capped by THEIR role. An unused registration is an inert row.
 *
 * What it is NOT allowed to be is an open redirect, so redirect_uris are validated
 * here (lib/oauth/redirect-uri.ts) and then exact-matched at both /authorize and /token.
 */

export const dynamic = 'force-dynamic'

// A registration is cheap but not free. Cap the obvious abuse.
const MAX_REDIRECT_URIS = 10
const MAX_NAME_LEN = 200

export async function POST(req: NextRequest) {
  // This endpoint MUST be unauthenticated (the client has no credential yet), and
  // each call writes a row. Without a limit it's an unbounded insert primitive for
  // anyone on the internet. A genuine client registers once, so a tight per-IP cap
  // costs real users nothing.
  const limited = await rateLimit({ key: `oauth-register:${getClientIp(req)}`, limit: 10, windowSeconds: 3600 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return err('invalid_client_metadata', 'Expected a JSON body')
  }

  const redirectUris: unknown = (body as any).redirect_uris
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return err('invalid_redirect_uri', 'redirect_uris is required')
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    return err('invalid_redirect_uri', `At most ${MAX_REDIRECT_URIS} redirect URIs`)
  }

  // The policy, and the reasoning behind admitting native schemes, lives in lib/oauth/redirect-uri.ts.
  const uris: string[] = []
  for (const raw of redirectUris) {
    const verdict = validateRedirectUri(raw)
    if (!verdict.ok) return err('invalid_redirect_uri', verdict.reason)
    uris.push(raw as string)
  }

  // Public client (PKCE, no secret) is the default and is what Claude registers as.
  const authMethod = typeof (body as any).token_endpoint_auth_method === 'string'
    ? (body as any).token_endpoint_auth_method
    : 'none'
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(authMethod)) {
    return err('invalid_client_metadata', `Unsupported token_endpoint_auth_method: ${authMethod}`)
  }

  const clientName = typeof (body as any).client_name === 'string'
    ? (body as any).client_name.slice(0, MAX_NAME_LEN)
    : null

  try {
    const admin = createAdminClient()
    const client = await registerClient(admin, {
      clientName,
      clientUri: strOrNull((body as any).client_uri),
      logoUri: strOrNull((body as any).logo_uri),
      redirectUris: uris,
      tokenEndpointAuthMethod: authMethod,
      scope: typeof (body as any).scope === 'string' ? (body as any).scope : 'read',
    })

    // RFC 7591 §3.2.1 — 201 with the registered metadata echoed back. The secret,
    // if any, is returned exactly once and is unrecoverable afterwards.
    return NextResponse.json(
      {
        client_id: client.client_id,
        ...(client.client_secret ? { client_secret: client.client_secret } : {}),
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        scope: 'read write',
      },
      { status: 201, headers: cors() }
    )
  } catch (e) {
    console.error('[oauth/register] failed:', e)
    return err('invalid_client_metadata', 'Could not register the client', 500)
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() })
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function err(code: string, description: string, status = 400) {
  return NextResponse.json({ error: code, error_description: description }, { status, headers: cors() })
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
