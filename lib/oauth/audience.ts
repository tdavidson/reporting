/**
 * Which protected boundary an OAuth token was issued for (RFC 8707 `resource`).
 *
 * SEC-009: the `resource` parameter was honoured at the authorization endpoint and persisted onto
 * both the code and the token — and then never read again. A token a client obtained for the MCP
 * endpoint, which is the resource the discovery document advertises, authenticated just as well
 * against `/api/v1`. The two surfaces are not equivalent: one is the agent tool boundary, the other
 * is the native-app boundary with conversations and pending-action approvals behind it. A token
 * scoped to one should not open the other.
 *
 * Resources are absolute URLs whose host varies by deployment (preview URLs, a bare *.vercel.app,
 * localhost on some port — see `issuerFor`), so the host is deliberately NOT part of the
 * comparison. What identifies the boundary is the path.
 */

export type OAuthAudience = 'mcp' | 'v1'

const PATH_PREFIXES: Record<OAuthAudience, string> = {
  mcp: '/api/mcp',
  v1: '/api/v1',
}

/**
 * The boundary a stored `resource` names, or null when it names none we recognise.
 *
 * Null covers two different things and the caller has to know which: a token issued with no
 * `resource` at all (nothing was claimed), and a token issued for something we do not serve.
 * `tokenAllowedAt` distinguishes them.
 */
export function audienceOf(resource: string | null | undefined): OAuthAudience | null {
  if (!resource) return null
  let pathname: string
  try {
    pathname = new URL(resource).pathname
  } catch {
    // Not a URL. RFC 8707 requires an absolute URI, so this is a malformed request that got
    // stored; treat it as naming nothing rather than as naming everything.
    return null
  }
  const entries = Object.entries(PATH_PREFIXES) as [OAuthAudience, string][]
  const match = entries.find(([, prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  return match ? match[0] : null
}

/**
 * May a token carrying this `resource` be used at this boundary?
 *
 * A token with NO resource is accepted anywhere. That is a deliberate transitional weakening, not
 * an oversight: tokens issued before this check existed have `resource: null`, and rejecting them
 * would sign every current client out to close a gap they are not the ones exploiting. The attack
 * the finding describes — a token minted for the advertised MCP resource being replayed against
 * `/api/v1` — is closed either way, because that token DOES carry a resource, and it is the wrong
 * one. Tighten this to require a resource once no null-resource tokens remain in `oauth_tokens`.
 */
export function tokenAllowedAt(resource: string | null | undefined, boundary: OAuthAudience): boolean {
  if (!resource) return true
  const audience = audienceOf(resource)
  // An unrecognised resource is refused everywhere: something was claimed, and it was not this.
  if (audience === null) return false
  return audience === boundary
}
