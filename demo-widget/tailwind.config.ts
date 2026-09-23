import fs from 'node:fs'
import path from 'node:path'
import type { Config } from 'tailwindcss'
import base from '../tailwind.config'

/**
 * The app's Tailwind config, narrowed to the files esbuild actually bundled (build.mjs writes
 * the list from its metafile) and scoped: every utility is prefixed with `.oa-demo-page`, the
 * class the host puts on <body>, so nothing leaks into the marketing site and the site's own
 * utilities of the same name do not leak in. Portals render under <body>, so they are covered.
 */
const listFile = path.join(__dirname, 'dist', 'content-files.json')
const content: string[] = fs.existsSync(listFile)
  ? JSON.parse(fs.readFileSync(listFile, 'utf8'))
  : ['./demo-widget/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}']

const config: Config = {
  ...base,
  content,
  important: '.oa-demo-page',
  corePlugins: { preflight: false },
}

export default config
