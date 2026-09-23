import { DiligenceIndex } from '@/app/(app)/diligence/diligence-index'
import { DealDetail } from '@/app/(app)/diligence/[id]/deal-detail'
import { InboxView } from '@/app/(app)/diligence/inbox/inbox-view'
import { QAChat } from '@/app/(app)/diligence/[id]/qa/qa-chat'
import { MemoEditor } from '@/app/(app)/diligence/[id]/drafts/[draftId]/memo-editor'
import { withData, type RouteRender } from '../route-helpers'

export const renders: Record<string, RouteRender> = {
  '/diligence': withData(d => <DiligenceIndex {...(d as any)} />),
  '/diligence/inbox': () => <InboxView />,
  '/diligence/:id': withData((d, ctx) => <DealDetail {...(d as any)} initialTab={ctx.query.get('tab') === 'data-room' ? 'Data Room' : 'Checklist'} />),
  '/diligence/:id/qa': withData(d => <QAChat {...(d as any)} />),
  '/diligence/:id/drafts/:draftId': withData(d => <MemoEditor {...(d as any)} />),
}
