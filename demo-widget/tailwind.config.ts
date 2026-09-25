import fs from 'node:fs'
import path from 'node:path'
import type { Config } from 'tailwindcss'
import base from '../tailwind.config'

/**
 * The app's Tailwind config, unchanged except for `content`: narrowed to the files esbuild
 * actually bundled (build.mjs writes the list from its metafile). Preflight, the plugins, the
 * theme — all the app's. build.mjs compiles app/globals.css with it and scope-css.mjs scopes the
 * result to the widget, so the demo is styled by the same stylesheet as the product.
 */
const listFile = path.join(__dirname, 'dist', 'content-files.json')
const content: string[] = fs.existsSync(listFile)
  ? JSON.parse(fs.readFileSync(listFile, 'utf8'))
  : ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}', './demo-widget/**/*.{ts,tsx}']

const config: Config = { ...base, content }

export default config
