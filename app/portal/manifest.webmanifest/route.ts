import { buildPortalManifest, loadPwaBrand, manifestResponse } from '@/lib/pwa'

// The LP portal's manifest, linked from app/portal/layout.tsx.
//
// Brand comes from loadPwaBrand (the deployment's fund) rather than getPortalFund
// (the fund behind the signed-in LP). Both resolve to the same fund on a single-fund
// deployment, and the former needs no session — which matters here, because
// /portal/welcome is reachable before an LP has one, and that is exactly where a new
// LP is most likely to install.
export const dynamic = 'force-dynamic'

export async function GET() {
  return manifestResponse(buildPortalManifest(await loadPwaBrand()))
}
