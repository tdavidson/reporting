import packageJson from '@/package.json'

export const API_VERSION = 1 as const
export const SERVER_VERSION = packageJson.version
export const PRESENTATION_BLOCKS_VERSION = 1 as const

/**
 * Capabilities the app reads before it renders anything.
 *
 * Both are false, and both are meant to be flipped by the phase that makes them true rather than
 * by the phase that adds the field. Advertising a capability the server does not have is worse
 * than not advertising it: the app offers the affordance and then fails at it, which reads to a
 * user as the app being broken rather than the server being older.
 */

/** POST /api/v1/chat/stream exists as of Phase 5 (coarse events; see lib/api-v1/stream.ts). */
export const SUPPORTS_CHAT_STREAMING = true

/**
 * Phase 8 turns this on when a demo CREDENTIAL exists.
 *
 * Deliberately NOT derived from `DEMO_USER_EMAIL`. That configures the browser demo — a shared
 * account a visitor is signed into by a server action — and there is no way to obtain a token for
 * it through /api/v1. An installation with that env var set still cannot serve a native demo, so
 * reporting `true` from it would be a lie the app acts on.
 */
export const SUPPORTS_PUBLIC_DEMO = false
