import { Mail } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export default function InboundExplainerPage() {
  return (
    <ExplainerContent
      title="Inbound"
      icon={Mail}
      screenshotSrc="/screenshots/inbound.png"
      screenshotLabel="Inbound Emails"
    >
      <p className="text-muted-foreground">
        Inbound shows every email that has been received and processed by the system. It&apos;s the
        audit trail for all automated report ingestion. Each row displays the sender, subject line,
        which company the email was matched to, and the processing status (success, needs review,
        failed, processing, or pending).
      </p>
      <p className="text-muted-foreground">
        You can filter the list by status and date range to quickly find specific emails. Filters
        apply immediately as you change them. The list is paginated and sorted by most recent first,
        so new emails always appear at the top.
      </p>
      <p className="text-muted-foreground">
        Clicking on any email opens its detail view. There you&apos;ll see the full processing
        result: which company was identified, which metrics were extracted and their values, the
        reporting period that was detected, and any review items that were created. The raw email
        body and attachment information are also available for reference.
      </p>
      <p className="text-muted-foreground">
        If an email failed processing (for example, the AI key was misconfigured or the email
        content was unreadable), you can see the error message in the detail view. For emails
        stuck in &ldquo;needs review,&rdquo; you can open the review modal directly from the
        Inbound page to resolve flagged items without navigating to the Review queue.
      </p>
      <p className="text-muted-foreground">
        The platform can also store documents for you automatically. If your admin has connected
        Google Drive or Dropbox in Settings, every inbound email and its attachments are saved
        into company-specific folders &mdash; organized by company name &mdash; so you always have
        the original source files alongside the extracted data.
      </p>
    </ExplainerContent>
  )
}
