/**
 * Paths BotId should classify before the handler runs.
 *
 * Mounted by `<BotIdClient>` in app/layout.tsx. It lives in its own module so the list and the
 * mount can be asserted separately — see tests/botid-client.test.ts, which exists because a
 * declared-but-never-loaded protect list is indistinguishable from a working one until the
 * server-side check starts failing closed in production.
 *
 * This list alone enforces nothing. `checkBotId()` on the server is what actually refuses a
 * request; the entry here is what gives an honest client the token to pass it. The two have to
 * agree: a path checked server-side but missing here fails EVERY request, because no browser
 * ever attached a challenge.
 *
 * `/demo` is the demo's server action, which posts to the page route rather than to /api.
 *
 * `/api/demo/seed` stays: the route is gitignored (.gitignore — Hemrock-specific fixtures) so it
 * is absent from a clone, but it exists on this deployment and provisions the demo fund.
 *
 * NOTE: of these, only `/demo` is actually enforced — `checkBotId()` is called in
 * app/demo/actions.ts and nowhere else yet. The other two are declarations waiting for their
 * server-side call, deliberately left for their own change.
 */
export const BOTID_PROTECTED_ROUTES = [
  { path: '/api/auth/*', method: 'POST' },
  { path: '/api/demo/seed', method: 'POST' },
  { path: '/demo', method: 'POST' },
]
