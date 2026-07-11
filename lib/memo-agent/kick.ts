// Nudge the memo-agent worker to start draining the job queue NOW, instead of
// waiting for the next cron tick. Best-effort and fire-and-forget: we only need
// the request to reach the worker function (which then drains independently), so
// we start the fetch and abort our wait after a moment. Any failure is swallowed
// — the cron in vercel.json is the safety net that guarantees jobs still run.

function workerBaseUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL
    ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
    ?? process.env.VERCEL_URL
  if (!base) return null
  return (base.startsWith('http') ? base : `https://${base}`).replace(/\/$/, '')
}

export async function kickWorker(): Promise<void> {
  const secret = process.env.CRON_SECRET
  const base = workerBaseUrl()
  if (!secret || !base) return // not configured (e.g. local dev) — cron handles it
  try {
    await fetch(`${base}/api/cron/memo-agent-worker`, {
      headers: { authorization: `Bearer ${secret}` },
      // We just need to trigger the invocation; abort our own wait quickly so the
      // caller isn't blocked on the worker's full drain. The worker keeps running.
      signal: AbortSignal.timeout(1500),
    })
  } catch {
    // Aborted (expected) or unreachable — the cron backstop will pick it up.
  }
}
