import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { pkceValid, grantableScope, redirectUriAllowed, clientSecretValid, hashToken } from './store'

/**
 * The pure guards in the OAuth flow. Each of these is the *only* thing standing
 * between an attacker and someone's fund, so they get pinned explicitly.
 */

function challengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

const VERIFIER = 'a'.repeat(64) // within the RFC's 43..128 range

describe('PKCE (S256)', () => {
  it('accepts the verifier that produced the challenge', () => {
    expect(pkceValid(VERIFIER, challengeFor(VERIFIER))).toBe(true)
  })

  it('rejects a different verifier — an intercepted code is useless without it', () => {
    expect(pkceValid('b'.repeat(64), challengeFor(VERIFIER))).toBe(false)
  })

  it('rejects a verifier that is too short or too long (RFC 7636 §4.1)', () => {
    expect(pkceValid('short', challengeFor('short'))).toBe(false)
    expect(pkceValid('x'.repeat(129), challengeFor('x'.repeat(129)))).toBe(false)
  })

  it('rejects a plain-text challenge — S256 only, never `plain`', () => {
    // If `plain` were honoured, challenge === verifier would pass. It must not.
    expect(pkceValid(VERIFIER, VERIFIER)).toBe(false)
  })

  it('rejects an empty verifier', () => {
    expect(pkceValid('', challengeFor(VERIFIER))).toBe(false)
  })
})

describe('redirect_uri matching', () => {
  const client = {
    client_id: 'c1',
    client_secret_hash: null,
    client_name: null,
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    token_endpoint_auth_method: 'none',
  }

  it('accepts an exact registered URI', () => {
    expect(redirectUriAllowed(client, 'https://claude.ai/api/mcp/auth_callback')).toBe(true)
  })

  it('rejects a prefix-extended URI — no open redirect via path suffix', () => {
    expect(redirectUriAllowed(client, 'https://claude.ai/api/mcp/auth_callback/../../evil')).toBe(false)
    expect(redirectUriAllowed(client, 'https://claude.ai/api/mcp/auth_callback?x=1')).toBe(false)
  })

  it('rejects a lookalike host', () => {
    expect(redirectUriAllowed(client, 'https://claude.ai.evil.com/api/mcp/auth_callback')).toBe(false)
    expect(redirectUriAllowed(client, 'https://evil.com/api/mcp/auth_callback')).toBe(false)
  })
})

describe('scope ceiling', () => {
  it('grants write to an admin who asks for it', () => {
    expect(grantableScope('read write', 'admin')).toBe('read write')
  })

  it('grants write to a member who asks — their GRANTS decide what it reaches', () => {
    // This used to downgrade every non-admin to read. It no longer needs to: the scope is only a
    // ceiling, and authorizeToolUse re-reads the owner's live per-domain grants on every call, so
    // a write token held by someone with read-only grants writes nothing. Downgrading here as
    // well would mean a member who IS granted write in a domain couldn't drive it from a
    // connector, though they can from the UI.
    expect(grantableScope('read write', 'member')).toBe('read write')
  })

  it('DOWNGRADES the read-only demo, which may never hold a write token', () => {
    expect(grantableScope('read write', 'viewer')).toBe('read')
    expect(grantableScope('write', 'viewer')).toBe('read')
  })

  it('DOWNGRADES a member whose grants let them write nowhere', () => {
    // The consent screen tells the user what the app will be able to do. Handing a read-only
    // member a write-scoped token would promise writes that every per-domain check then refuses —
    // the refusal is right, the promise was the bug.
    expect(grantableScope('read write', 'member', false)).toBe('read')
    expect(grantableScope('read write', 'member', true)).toBe('read write')
  })

  it('still grants write to someone who can write SOMEWHERE', () => {
    // Scope is global, grants are per-domain: write in one domain is enough to need the scope,
    // and authorizeToolUse still refuses the domains they lack.
    expect(grantableScope('read write', 'admin', true)).toBe('read write')
  })

  it('defaults to read when nothing is asked for', () => {
    expect(grantableScope(null, 'admin')).toBe('read')
    expect(grantableScope('', 'admin')).toBe('read')
  })

  it('ignores scopes it does not know rather than passing them through', () => {
    expect(grantableScope('read admin:all delete', 'admin')).toBe('read')
  })

  it('accepts comma-delimited as well as space-delimited scope strings', () => {
    expect(grantableScope('read,write', 'admin')).toBe('read write')
  })
})

describe('client authentication', () => {
  it('lets a public client through — PKCE is its proof, not a secret', () => {
    const pub = {
      client_id: 'c1', client_secret_hash: null, client_name: null,
      redirect_uris: [], token_endpoint_auth_method: 'none',
    }
    expect(clientSecretValid(pub, null)).toBe(true)
  })

  it('requires the right secret from a confidential client', () => {
    const secret = 'mcs_' + 'x'.repeat(40)
    const conf = {
      client_id: 'c2', client_secret_hash: hashToken(secret), client_name: null,
      redirect_uris: [], token_endpoint_auth_method: 'client_secret_post',
    }
    expect(clientSecretValid(conf, secret)).toBe(true)
    expect(clientSecretValid(conf, 'mcs_wrong')).toBe(false)
    expect(clientSecretValid(conf, null)).toBe(false)
  })
})
