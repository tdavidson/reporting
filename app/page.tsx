import { redirect } from 'next/navigation'

/**
 * `/` has no page of its own any more. The marketing page that rendered here moved to
 * www.otheradmin.com (the otheradmin-site repository), so this deployment is only ever the
 * app: proxy.ts sends a signed-out visitor to /auth, a GP to /start and an LP to their
 * portal before this renders. Whoever reaches it (a signed-in user with no membership yet)
 * gets the same destination the auth callbacks use.
 */
export default function RootPage() {
  redirect('/start')
}
