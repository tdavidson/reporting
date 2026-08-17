import { defineConfig } from 'vitest/config'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

/**
 * Live-database tests, deliberately excluded from `npm test`. They need .env.local credentials
 * and write (then remove) rows in a real fund.
 *
 * .env.local is loaded into process.env here because the app's own code reaches for it
 * directly — decryptApiKey reads ENCRYPTION_KEY (the key-encryption key) from the environment,
 * so a test that resolves a fund's AI provider fails without it. Next loads this file for the
 * app; vitest does not.
 */
function loadEnvLocal() {
  const file = path.resolve(__dirname, '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const i = trimmed.indexOf('=')
    const key = trimmed.slice(0, i).trim()
    const value = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnvLocal()

export default defineConfig({
  test: {
    include: ['tests/live/**/*.live-test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
