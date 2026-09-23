# The public demo widget

The product, mounted on www.otheradmin.com/demo around a sample fund: the app's own shell
(header, sidebar, command palette, Analyst, phone tab bar) and every page a viewer can open,
rendered by the same components the app renders, on a snapshot of the demo fund. No sign-in,
no database, no model call: the data is recorded, and the Analyst's replies are stored.

## How it works

Two substitutions make the app's component tree run inside a static page:

- **`fetch`.** While the widget is mounted every `/api/*` request on the page is answered by
  `mock-api.ts`: first from `data/api.json` (what the real API returned to the demo fund's
  viewer for that request), then from `data/snapshot.json` for the routes the palette and the
  Analyst call, then 404, which every component already treats as "empty". Writes get the
  read-only demo's 403. The components that take `fetch` from `components/app-runtime.tsx`
  get it there; the rest call the global, which `index.tsx` wraps before the first render.
- **`navigate`.** `app.tsx` keeps the current path and swaps the page instead of the URL.
  `stubs/next-navigation.ts` answers `usePathname`, `useParams` and `useSearchParams` from it,
  and `stubs/next-link.tsx` renders the app's links as anchors the frame intercepts.

`routes.tsx` is the table: each of the app's URL patterns and the component the app renders
for it. A client page (`'use client'` under `app/(app)`) is mounted as is. A server page —
one that queried Postgres in the component — has been split into a loader (`load.ts`, run by
the page and by the snapshot script) and a client view (`page-view.tsx`, mounted by the page
and by the widget); the widget hands the view the loader's recorded output from
`data/pages.json`, keyed by URL, or a thinner equivalent `fallbacks.ts` builds from the
snapshot until that has been recorded. `lib/pages/registry.ts` lists the loaders and how to
enumerate their URLs for a fund. `routes.test.ts` fails when a page exists in the app
without a demo route or a reason.

`build.mjs` bundles `index.tsx` with esbuild (React included; `next/*`, `next-themes`, `xlsx`
and the browser Supabase client swapped for `stubs/`) as an ES module split by section. The
stylesheet is the app's own: `app/globals.css` compiled with the app's Tailwind config for
exactly the files in the bundle, then scoped by `scope-css.mjs`, which rewrites only the
selectors so each rule matches inside the widget and nowhere else, at the same specificity
it has in the app. The widget's frame and every portal it opens carry `oa-demo-root`; a short
reset in front puts their elements back to browser defaults, so the host page's stylesheet
never reaches them and the app's rules apply exactly as they do in the app. Rem sizes are
compiled to the pixels the app renders at, so a host's root font size cannot scale the demo.

The build writes:

| File | What |
| --- | --- |
| `dist/widget.js` | IIFE exposing `OtherAdminDemo.mount(el, { snapshot, answers, pages, api, chrome: 'page' \| 'card', initialPath, onNavigate })` and `OtherAdminDemo.routes(snapshot, pages)` |
| `dist/widget.css` | the app's stylesheet, scoped; `dark` on `<html>` switches the theme |
| `dist/snapshot.json` | the sample fund (`types.ts` is the contract; `schemaVersion` guards it) |
| `dist/pages.json` | every server page's loaded data, keyed by URL |
| `dist/api.json` | every recorded API response, keyed by method, path and query |
| `dist/answers.json` | stored Analyst replies, suggestions per scope, and the fallback text |
| `dist/manifest.json` | version, build time, schema versions, `generatedBy` of the answers |

```bash
npm run demo:widget          # builds dist/; dist/ is gitignored
npm run demo:check           # walks every page of the build in Chromium; crashes fail, misses are listed
npm run demo:check -- --shots /tmp/shots   # and screenshots each page
npm run demo:styles          # the demo against the app, style by style; any difference fails
```

`demo:styles` renders the same pages twice, in both themes and with the command palette open:
once under the app's own stylesheet on a bare page (the product), once under the widget's
inside `check-host.css`, a host page written to restyle everything. It compares every
element's computed style and fails on any difference. The workflow runs it before publishing,
so the demo cannot drift from the app's styles without the publish stopping.

## Publishing

`.github/workflows/demo-widget.yml` rebuilds on every push to `main` that touches
`app/`, `components/`, `lib/`, `demo-widget/`, the tokens or the Tailwind config, runs the
check, and uploads `dist/*` as the assets of the rolling GitHub release `demo-widget-latest`.
The marketing site's build downloads them from there and checks the manifest, so a change to
any page reaches the demo on the site's next deploy. Set the `OTHERADMIN_SITE_DEPLOY_HOOK`
secret to a Vercel deploy hook and the workflow triggers that deploy itself.

## Keeping the data current

Three files, three scripts, all run locally against the demo fund and committed:

1. `npm run demo:snapshot` (needs `.env.local`: the service role, and `DEMO_USER_EMAIL` /
   `DEMO_USER_PASSWORD` for a viewer in the demo fund; `DEMO_FUND_NAME` picks the fund,
   `DEMO_FUND_LABEL` the name shown) re-exports `data/snapshot.json` and runs every loader in
   `lib/pages/registry.ts` as that viewer into `data/pages.json`.
2. `npm run demo:widget && DEMO_ORIGIN=https://<the app> DEMO_EMAIL=… DEMO_PASSWORD=… npm run demo:record`
   signs in to a running instance as the viewer, mounts the build with `/api` proxied to it,
   walks every page and every tab, and records the responses into `data/api.json`. The
   middleware and RLS are in the path, so it can only record what the viewer sees.
3. `DEMO_USER_ID=… npm run demo:answers` asks the real Analyst every question in
   `data/answers.json` and stores the replies with the model that wrote them. It spends the
   fund's API key, so run it when the snapshot or the question list changes, not routinely.
   Until it has been run, `generatedBy` is `authored`: the replies were written by hand
   against the snapshot and read as the Analyst would, but no model produced them.

`npm run demo:check` after a build says which requests the recording does not cover; a page
whose data is missing renders its empty state, not an error. To add a question, add an
entry to `answers` (scope `portfolio` or `company:<id>`, a question, optional `aliases`) and,
if it should be offered, to `suggestions`.

## When the app changes

- A **new client page**: add a route to `routes.tsx`; `routes.test.ts` says so until you do.
- A **new server page**: give it a `load.ts` and a `page-view.tsx` like `app/(app)/deals`,
  register the loader, add the route, and re-run the snapshot.
- A **component that reads a new API route**: the check lists it as unanswered; re-run the
  recorder.
- A **field the snapshot lacks**: add it to `types.ts` and `scripts/demo-snapshot.ts`, bump
  `DEMO_SCHEMA_VERSION` if the shape changes incompatibly, and the site's build refuses a
  widget and snapshot that disagree.
