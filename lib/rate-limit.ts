import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RateLimitConfig {
  /** Unique key for the rate limit bucket (e.g., `auth:${ip}` or `ai:${userId}`) */
  key: string
  /** Maximum number of requests allowed in the window */
  limit: number
  /** Window size in seconds */
  windowSeconds: number
}

// ---------------------------------------------------------------------------
// In-memory fallback rate limiter (used when DB is unavailable)
// ---------------------------------------------------------------------------

const memoryBuckets = new Map<string, number[]>()
const MEMORY_CLEANUP_INTERVAL = 60_000
let lastMemoryCleanup = Date.now()

function memoryRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()

  // Periodic cleanup of stale keys
  if (now - lastMemoryCleanup > MEMORY_CLEANUP_INTERVAL) {
    lastMemoryCleanup = now
    for (const [k, timestamps] of Array.from(memoryBuckets.entries())) {
      const filtered = timestamps.filter(t => now - t < windowMs)
      if (filtered.length === 0) memoryBuckets.delete(k)
      else memoryBuckets.set(k, filtered)
    }
  }

  const timestamps = (memoryBuckets.get(key) ?? []).filter(t => now - t < windowMs)

  if (timestamps.length >= limit) {
    memoryBuckets.set(key, timestamps)
    return false // Blocked
  }

  timestamps.push(now)
  memoryBuckets.set(key, timestamps)
  return true // Allowed
}

// ---------------------------------------------------------------------------
// Main rate limiter — atomic DB operation with in-memory fallback
// ---------------------------------------------------------------------------

/**
 * Sliding-window rate limiter backed by Supabase.
 * Uses an atomic RPC call to check-and-increment in a single DB round-trip,
 * preventing TOCTOU race conditions.
 *
 * Falls back to an in-memory rate limiter if the DB is unavailable (fail-closed
 * rather than fail-open).
 *
 * Returns null if the request is allowed, or a 429 NextResponse if rate limited.
 */
export async function rateLimit(config: RateLimitConfig): Promise<NextResponse | null> {
  const { key, limit, windowSeconds } = config

  try {
    const admin = createAdminClient()

    // Atomic check-and-increment: deletes expired entries, counts remaining,
    // inserts new entry, and returns the count — all in one DB call.
    const { data, error } = await admin.rpc('rate_limit_check' as any, {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })

    if (error) throw error

    // RPC returns the count AFTER inserting. If count > limit, we're over.
    const count = typeof data === 'number' ? data : (data as any)?.count ?? 0
    if (count > limit) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(windowSeconds),
          },
        }
      )
    }

    return null // Allowed
  } catch (err) {
    // DB unavailable — fall back to in-memory rate limiting (fail-closed)
    console.error('[rate-limit] DB error, using in-memory fallback:', err)

    const allowed = memoryRateLimit(key, limit, windowSeconds * 1000)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(windowSeconds),
          },
        }
      )
    }

    return null // Allowed by in-memory fallback
  }
}

/**
 * Extract client IP from request headers.
 * Only trusts platform-injected headers that cannot be spoofed by the caller.
 * When no trusted header is found, falls back to 'unknown' — all such requests
 * share a single rate-limit bucket with a tighter effective limit.
 */
export function getClientIp(req: Request): string {
  const headers = req.headers
  return (
    // Vercel injects x-real-ip from the TCP connection (cannot be spoofed)
    headers.get('x-real-ip') ||
    // Netlify injects x-nf-client-connection-ip (cannot be spoofed)
    headers.get('x-nf-client-connection-ip') ||
    // Fallback — shared bucket. Rate limit configs should use tighter limits
    // for the 'unknown' bucket to prevent abuse on non-Vercel/Netlify deployments.
    'unknown'
  )
}
