import { revalidateTag } from 'next/cache'

/**
 * Expire every cache entry carrying `tag`, NOW.
 *
 * Next 16 made `revalidateTag`'s second argument mandatory. The documented choice, `'max'`, is
 * stale-while-revalidate: the next request is served the OLD entry while a fresh one is computed
 * behind it. That is a fine default for a blog and the wrong one for what this app tags —
 * `membership`, `domain-grants` and `fund-settings` are the inputs to access resolution, and a
 * badge that lags one render is a smaller problem than a nav that still shows a section whose
 * grant was just revoked.
 *
 * An inline `{ expire: 0 }` profile is the immediate-expiration form: the same semantics the
 * one-argument call had before the change, usable from a route handler (where `updateTag`, the
 * other immediate form, throws by design). This helper exists so that decision is written down
 * once rather than pasted twenty-four times.
 */
export function expireTag(tag: string): void {
  revalidateTag(tag, { expire: 0 })
}
