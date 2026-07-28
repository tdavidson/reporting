import { initBotId } from 'botid/client/core'

// Paths BotId should classify before the handler runs. The matching server-side
// `checkBotId()` call is what actually enforces anything — this list alone does nothing.
//
// `/demo` is the demo's server action, which posts to the page route rather than to /api.
//
// `/api/demo/seed` stays: the route is gitignored (.gitignore — Hemrock-specific fixtures) so it
// is absent from a clone, but it exists on this deployment and provisions the demo fund.
//
// NOTE: of these, only `/demo` is actually enforced — `checkBotId()` is called in
// app/demo/actions.ts and nowhere else yet. The other two are declarations waiting for their
// server-side call, deliberately left for their own change.
initBotId({
  protect: [
    { path: '/api/auth/*', method: 'POST' },
    { path: '/api/demo/seed', method: 'POST' },
    { path: '/demo', method: 'POST' },
  ],
})
