import { defineConfig } from 'vitest/config'
import path from 'path'

// Live-database tests, deliberately excluded from `npm test`. They need .env.local
// credentials and write (then remove) rows in a real fund.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.live-test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
