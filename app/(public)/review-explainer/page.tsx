import { ClipboardCheck } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export default function ReviewExplainerPage() {
  return (
    <ExplainerContent
      title="Review"
      icon={ClipboardCheck}
      screenshotSrc="/screenshots/review.png"
      screenshotLabel="Review Queue"
    >
      <p className="text-muted-foreground">
        When inbound emails are processed, the AI pipeline sometimes flags items that need a human
        decision. These flagged items appear in the Review queue. Common reasons include: a new
        company name was detected that doesn&apos;t match any existing portfolio company, a metric
        value was extracted with low confidence, a reporting period was ambiguous, or a metric
        couldn&apos;t be found in the report at all.
      </p>
      <p className="text-muted-foreground">
        Each review item shows you the issue type, the extracted value (if any), and a snippet of
        context from the source email so you can make an informed decision. You can accept the
        extracted value as-is, reject it, or manually correct it with the right number. For new
        company detections, you can create the company or map it to an existing one.
      </p>
      <p className="text-muted-foreground">
        The review badge in the sidebar shows how many items are waiting for attention. Once all
        review items for a given email are resolved, that email&apos;s status automatically moves
        from &ldquo;needs review&rdquo; to &ldquo;success.&rdquo; You can also dismiss all review
        items for an email at once if the entire report should be skipped.
      </p>
      <p className="text-muted-foreground">
        Staying on top of the review queue is important - it&apos;s how you ensure the
        data flowing into your portfolio metrics is accurate. The system is designed to err on the
        side of flagging rather than silently writing bad data.
      </p>
    </ExplainerContent>
  )
}
