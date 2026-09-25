import LpsPage from '@/app/(app)/lps/page'
import { LpCapitalView } from '@/app/(app)/lps/capital/view'
import { LpPortalDashboard } from '@/app/(app)/lp-portal/lp-portal-dashboard'
import { LpActivityDashboard } from '@/app/(app)/lp-activity/lp-activity-dashboard'
import LiveCardsPage from '@/app/(app)/lps/cards/page'
import LiveCardPage from '@/app/(app)/lps/cards/[investorId]/page'
import type { RouteRender } from '../route-helpers'

export const renders: Record<string, RouteRender> = {
  '/lps': () => <LpsPage />,
  '/lps/capital': () => <div className="px-4 md:pl-8 md:pr-4 pt-4 md:pt-6 pb-8 w-full"><LpCapitalView isAdmin={false} /></div>,
  '/lps/cards': () => <LiveCardsPage />,
  '/lps/cards/:investorId': () => <LiveCardPage />,
  '/lp-portal': () => <LpPortalDashboard />,
  '/lp-activity': () => <LpActivityDashboard />,
}
