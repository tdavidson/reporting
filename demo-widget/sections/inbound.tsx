import EmailsPage from '@/app/(app)/emails/page'
import { EmailPageView } from '@/app/(app)/emails/[id]/page-view'
import ReviewPage from '@/app/(app)/review/page'
import { DealsContent } from '@/app/(app)/deals/deals-content'
import { DealDetail } from '@/app/(app)/deals/[id]/deal-detail'
import { withData, type RouteRender } from '../route-helpers'

/** Inbound mail, review, and deal flow. */
export const renders: Record<string, RouteRender> = {
  '/emails': () => <EmailsPage />,
  '/emails/:id': withData(d => <EmailPageView {...(d as any)} />),
  '/review': () => <ReviewPage />,
  '/deals': withData(d => <DealsContent {...(d as any)} />),
  '/deals/:id': withData(d => <DealDetail {...(d as any)} />),
}
