import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { BOTID_PATH_PREFIX } from '@/lib/botid-routes'

/**
 * BotId's client-side protection has to be mounted through an entry point THIS version of Next
 * actually loads.
 *
 * The bug this pins: the protect list was declared in `instrumentation-client.ts`, which is a
 * Next 15.3+ entry point. On Next 14 that file is never compiled and never loaded — there is no
 * error, no warning, nothing in the build output. `initBotId()` simply never ran, so no challenge
 * token was ever attached to a request, and `checkBotId()` on the deployed site classified every
 * visitor as a bot. The only symptom was /demo answering "Demo is not available." to everyone.
 *
 * Both halves are silent on their own, which is why this is a test and not a comment: a dead
 * entry point looks exactly like a live one, and the server-side call that depends on it fails
 * closed. Locally it is invisible — `checkBotId()` short-circuits to `isBot: false` outside
 * production, so the demo works on a dev machine and only breaks once deployed.
 */

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** The installed Next version, as [major, minor]. */
function nextVersion(): [number, number] {
  const { version } = JSON.parse(read('node_modules/next/package.json'))
  const [major, minor] = version.split('.').map(Number)
  return [major, minor]
}

/** `instrumentation-client.ts` is only loaded from Next 15.3 onward. */
function supportsInstrumentationClient(): boolean {
  const [major, minor] = nextVersion()
  return major > 15 || (major === 15 && minor >= 3)
}

describe('BotId client-side protection', () => {
  it('is mounted through an entry point this Next version loads', () => {
    const layout = read('app/layout.tsx')

    if (supportsInstrumentationClient()) {
      // Next 15.3+: either mount is valid, but one of them has to exist.
      const viaInstrumentation = existsSync(join(root, 'instrumentation-client.ts'))
      const viaLayout = layout.includes('<BotIdClient')
      expect(viaInstrumentation || viaLayout).toBe(true)
      return
    }

    // Next < 15.3: `<BotIdClient>` in the layout is the ONLY mount that runs.
    expect(layout).toContain("from 'botid/client'")
    expect(layout).toContain('<BotIdClient')

    // And the dead one must not be lying around looking authoritative. Its presence is what
    // made this bug invisible: the protect list existed, it was just never loaded.
    expect(
      existsSync(join(root, 'instrumentation-client.ts')),
      'instrumentation-client.ts is a Next 15.3+ entry point and is dead code on Next ' +
        nextVersion().join('.') + ' — move the protect list into app/layout.tsx'
    ).toBe(false)
  })

  it('lets the challenge endpoints past the middleware', () => {
    // Middleware runs before next.config rewrites, so the challenge script is an
    // unauthenticated request like any other: without this exclusion it is redirected to
    // /auth, the browser gets HTML where it asked for JavaScript and refuses it on MIME
    // type, and BotId has no token to issue — so checkBotId() fails everyone closed.
    const matcher = read('proxy.ts').split('matcher:')[1]
    expect(matcher).toContain(BOTID_PATH_PREFIX)
  })

  it('pins BOTID_PATH_PREFIX to the prefix botid actually rewrites', () => {
    // The constant is duplicated into proxy.ts (config.matcher must be statically
    // analysable). If a botid upgrade moves this path, both copies are silently wrong and
    // the demo breaks the same way again — so read it off the installed package.
    const vendor = read('node_modules/botid/dist/next/config/index.mjs')
    expect(vendor).toContain(BOTID_PATH_PREFIX)
  })

  it('protects every path that calls checkBotId() server-side', () => {
    // `startDemo` is a server action on /demo, so the POST goes to the page route.
    expect(read('app/demo/actions.ts')).toContain('checkBotId')

    const routes = read('lib/botid-routes.ts')
    expect(routes).toContain("path: '/demo'")
    expect(routes).toContain("method: 'POST'")
  })
})
