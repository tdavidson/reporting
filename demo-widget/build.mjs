#!/usr/bin/env node
/**
 * Build the public demo widget: demo-widget/dist/{widget.js, widget.css, snapshot.json,
 * answers.json, manifest.json}.
 *
 *   npm run demo:widget
 *
 * 1. esbuild bundles demo-widget/index.tsx with the app's own components (React included, so
 *    the host page needs nothing) and the Next.js modules swapped for the stubs in ./stubs, as
 *    an ES module split at the dynamic imports in routes.tsx: widget.js is the shell and the
 *    dashboard, and each section of the app is a chunk fetched on first use.
 * 2. Tailwind compiles only the files that bundle pulled in, scoped under `.oa-demo-page`.
 * 3. The app's design tokens (:root and .dark in app/globals.css) are re-scoped and prepended,
 *    with the few base rules the components rely on and the host's preflight does not give.
 * 4. The data files are copied and a manifest written for the site's build to check against.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const dist = path.join(here, 'dist')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(dist, { recursive: true })

// 1. Script -------------------------------------------------------------------------------
const result = await build({
  entryPoints: [path.join(here, 'index.tsx')],
  outdir: dist,
  entryNames: 'widget',
  chunkNames: 'chunk-[hash]',
  bundle: true,
  minify: true,
  format: 'esm',
  splitting: true,
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  tsconfig: path.join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  // Anything else that reads process.env at runtime gets an empty object, not a ReferenceError.
  banner: { js: 'var process=typeof process==="undefined"?{env:{}}:process;' },
  alias: {
    'next/link': path.join(here, 'stubs', 'next-link.tsx'),
    'next/navigation': path.join(here, 'stubs', 'next-navigation.ts'),
    'next-themes': path.join(here, 'stubs', 'next-themes.ts'),
    'next/script': path.join(here, 'stubs', 'next-script.tsx'),
    '@/lib/supabase/client': path.join(here, 'stubs', 'supabase-client.ts'),
    // The bank page's spreadsheet parser, half a megabyte the read-only demo never runs.
    'xlsx': path.join(here, 'stubs', 'xlsx.ts'),
  },
  metafile: true,
  logLevel: 'warning',
  legalComments: 'none',
})

// 2. Styles, from the files that are actually in the bundle --------------------------------
const bundled = Object.keys(result.metafile.inputs)
  .filter(f => /\.(tsx?|jsx?)$/.test(f) && !f.includes('node_modules'))
  .map(f => path.resolve(root, f))
fs.writeFileSync(path.join(dist, 'content-files.json'), JSON.stringify(bundled, null, 1))

execFileSync(path.join(root, 'node_modules', '.bin', 'tailwindcss'), [
  '-c', path.join(here, 'tailwind.config.ts'),
  '-i', path.join(here, 'styles.css'),
  '-o', path.join(dist, 'tw.css'),
  '--minify',
], { stdio: 'inherit', cwd: root })

// 3. Tokens ---------------------------------------------------------------------------------
const globals = fs.readFileSync(path.join(root, 'app', 'globals.css'), 'utf8')
function block(css, selector) {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`${selector} block not found in app/globals.css`)
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  throw new Error(`${selector} block is unterminated`)
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()
const light = stripComments(block(globals, ':root'))
const dark = stripComments(block(globals, '.dark'))

const tokens = `
/* OtherAdmin demo widget. Built ${new Date().toISOString()} from otheradmin ${pkg.version}. */
.oa-demo-page{${light}}
.dark .oa-demo-page{${dark}}
/* The host's fonts, under the app's variable names. */
.oa-demo-page{--font-sans:var(--font-sans-face,Inter),ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--font-display:var(--font-sans);--font-serif:ui-serif,Georgia,serif;--font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
/* The slice of Tailwind's preflight the components assume, scoped to the widget and to the
   portals (dialog, sheet, select) that render under <body>. Every selector sits inside :where()
   so it has the specificity of one class and every utility (two classes, being scoped) wins. */
.oa-demo-page :where(.oa-demo,.oa-demo *,.oa-demo ::before,.oa-demo ::after,[role="dialog"],[role="dialog"] *,[data-radix-popper-content-wrapper],[data-radix-popper-content-wrapper] *){box-sizing:border-box;border-width:0;border-style:solid;border-color:hsl(var(--border));margin:0;padding:0}
.oa-demo-page :where(.oa-demo,[role="dialog"],[data-radix-popper-content-wrapper]){color:hsl(var(--foreground));font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;font-feature-settings:"tnum"}
.oa-demo-page :where(.oa-demo,[role="dialog"],[data-radix-popper-content-wrapper]) :where(h1,h2,h3,h4,h5,h6){font-size:inherit;font-weight:inherit}
.oa-demo-page :where(.oa-demo,[role="dialog"],[data-radix-popper-content-wrapper]) :where(button,input,textarea,select){font:inherit;color:inherit;background-color:transparent;background-image:none;letter-spacing:inherit}
.oa-demo-page :where(.oa-demo,[role="dialog"],[data-radix-popper-content-wrapper]) :where(button,[role="button"]){cursor:pointer;-webkit-appearance:button;appearance:button}
.oa-demo-page :where(.oa-demo,[role="dialog"],[data-radix-popper-content-wrapper]) :where(button:disabled){cursor:default}
.oa-demo-page :where(.oa-demo,[role="dialog"],[data-radix-popper-content-wrapper]) :where(svg,img){display:inline-block;vertical-align:middle;max-width:100%}
.oa-demo-page :where(.oa-demo,[role="dialog"],[data-radix-popper-content-wrapper]) :where(ol,ul){list-style:none}
.oa-demo-page :where(.oa-demo,[role="dialog"],[data-radix-popper-content-wrapper]) :where(table){border-collapse:collapse;text-indent:0}
.oa-demo-page :where(.oa-demo,[role="dialog"],[data-radix-popper-content-wrapper]) :where(a){color:inherit;text-decoration:inherit}
.oa-demo-page :where(.oa-demo,[role="dialog"],[data-radix-popper-content-wrapper]) :where(kbd,code,pre){font-family:var(--font-mono);font-size:1em}
.oa-demo-page :where(.oa-demo,[role="dialog"],[data-radix-popper-content-wrapper]) :where(textarea){resize:vertical}
.oa-demo-page :where(.oa-demo,[role="dialog"],[data-radix-popper-content-wrapper]) :where(::placeholder){color:hsl(var(--muted-foreground));opacity:1}
`.trim()

const tw = fs.readFileSync(path.join(dist, 'tw.css'), 'utf8')
fs.writeFileSync(path.join(dist, 'widget.css'), `${tokens}\n${tw}`)
fs.rmSync(path.join(dist, 'tw.css'))

// 4. Data + manifest -------------------------------------------------------------------------
for (const f of ['snapshot.json', 'answers.json', 'pages.json', 'api.json']) fs.copyFileSync(path.join(here, 'data', f), path.join(dist, f))
const chunks = fs.readdirSync(dist).filter(f => /^chunk-[A-Z0-9]+\.js$/i.test(f)).sort()
const snapshot = JSON.parse(fs.readFileSync(path.join(dist, 'snapshot.json'), 'utf8'))
const answers = JSON.parse(fs.readFileSync(path.join(dist, 'answers.json'), 'utf8'))
const manifest = {
  name: 'otheradmin-demo-widget',
  version: pkg.version,
  builtAt: new Date().toISOString(),
  schemaVersion: snapshot.schemaVersion,
  answersSchemaVersion: answers.schemaVersion,
  answersGeneratedBy: answers.generatedBy,
  global: 'OtherAdminDemo',
  files: ['widget.js', ...chunks, 'widget.css', 'snapshot.json', 'answers.json', 'pages.json', 'api.json'],
}
fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2))
fs.rmSync(path.join(dist, 'content-files.json'))

for (const f of manifest.files) {
  const size = fs.statSync(path.join(dist, f)).size
  console.log(`${f.padEnd(22)} ${(size / 1024).toFixed(0).padStart(6)} KB`)
}
