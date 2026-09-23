import type { createClient } from '@/lib/supabase/server'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { PageAccess } from '@/lib/access/page-gate'

/**
 * What a server page has in hand once it has passed its gate, and what its loader takes.
 *
 * A server component under app/(app) used to be one function: gate, query, render. The query
 * half now lives in a colocated `load.ts` so that two callers can run it — the page itself, and
 * scripts/demo-snapshot.ts, which runs every loader as the demo fund's viewer and stores the
 * results for the public demo widget (demo-widget/README.md). The render half is a client
 * component the page and the widget both mount. Neither caller can drift from the other: there
 * is one query and one view.
 *
 * `supabase` is the caller's own client (RLS applies), `admin` the service role; a loader uses
 * whichever the page used, so moving the query does not change what it can see.
 */
export type PageSupabase = Awaited<ReturnType<typeof createClient>>
export type PageAdmin = ReturnType<typeof createAdminClient>

export interface PageContext {
  supabase: PageSupabase
  admin: PageAdmin
  user: { id: string; email?: string | null }
  page: PageAccess
}
