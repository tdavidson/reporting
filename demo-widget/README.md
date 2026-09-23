# The public demo widget

The command palette and the Analyst, as they are in the product, mounted on
www.otheradmin.com/demo around a small rendering of a sample fund. No sign-in, no
database, no model call: the components are the app's own, the data is a snapshot,
and the Analyst's replies are stored.

## How it works

`components/app-runtime.tsx` gives the app's client components two things to reach
the outside world with: `fetch` and `navigate`. In the app both are the platform's
own. Here `fetch` is `mock-api.ts`, which answers the routes the palette and the
Analyst call from `data/snapshot.json` and `data/answers.json`, and `navigate`
switches the widget's screens (`screens.tsx`). The components do not change.

`build.mjs` bundles `index.tsx` with esbuild (React included, Next.js modules
swapped for `stubs/`), compiles Tailwind for exactly the files in that bundle
scoped under `.oa-demo-page`, prepends the app's design tokens from
`app/globals.css` re-scoped the same way, and writes:

| File | What |
| --- | --- |
| `dist/widget.js` | IIFE exposing `OtherAdminDemo.mount(el, { snapshot, answers })` |
| `dist/widget.css` | tokens + scoped utilities; put `oa-demo-page` on `<body>`, `dark` on `<html>` for dark mode |
| `dist/snapshot.json` | the sample fund (`types.ts` is the contract; `schemaVersion` guards it) |
| `dist/answers.json` | stored Analyst replies, suggestions per scope, and the fallback text |
| `dist/manifest.json` | version, build time, schema versions, `generatedBy` of the answers |

```bash
npm run demo:widget          # builds dist/; dist/ is gitignored
```

## Publishing

`.github/workflows/demo-widget.yml` rebuilds on every push to `main` that touches
`components/`, `lib/`, `demo-widget/`, the tokens or the Tailwind config, and
uploads `dist/*` as the assets of the rolling GitHub release `demo-widget-latest`.
The marketing site's build downloads them from there and checks the manifest, so a
change to the palette or the Analyst reaches the demo on the site's next deploy.
Set the `OTHERADMIN_SITE_DEPLOY_HOOK` secret to a Vercel deploy hook and the
workflow triggers that deploy itself.

## Keeping the data current

- `npx tsx scripts/demo-snapshot.ts` re-exports the demo fund into
  `data/snapshot.json` (service role from `.env.local`; `DEMO_FUND_NAME` picks the
  fund, `DEMO_FUND_LABEL` the name shown). Commit the result.
- `DEMO_USER_ID=… npx tsx scripts/demo-answers.ts` asks the real Analyst every
  question in `data/answers.json` and stores the replies with the model that wrote
  them. It spends the fund's API key, so run it when the snapshot or the question
  list changes, not routinely. Until it has been run, `generatedBy` is `authored`:
  the replies were written by hand against the snapshot and read as the Analyst
  would, but no model produced them.
- To add a question, add an entry to `answers` (scope `portfolio` or
  `company:<id>`, a question, optional `aliases` for other phrasings) and,
  if it should be offered, to `suggestions`. A typed question lands on the closest
  stored one by token overlap; below the threshold the visitor gets `fallback`.

## When a component starts needing more

If the palette or the Analyst begins reading a field the snapshot lacks, the mock
API is where it shows up. Add the field to `types.ts` and `scripts/demo-snapshot.ts`,
bump `DEMO_SCHEMA_VERSION` if the shape changes incompatibly, and the site's build
refuses a widget and snapshot that disagree.
