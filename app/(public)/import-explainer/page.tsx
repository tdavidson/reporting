import { Upload } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export default function ImportExplainerPage() {
  return (
    <ExplainerContent
      title="Import"
      icon={Upload}
      screenshotSrc="/screenshots/import.png"
      screenshotLabel="Import"
    >
      <p className="text-muted-foreground">
        Import lets you process reports manually when they arrive outside the normal email flow.
        You can paste email text directly, upload file attachments (PDFs, Excel spreadsheets, Word
        documents, PowerPoint decks, CSV files, and images up to 20 MB each), or combine both. The system runs the
        same AI pipeline as automated inbound processing &mdash; identifying the company, extracting
        metrics, and writing results to the database.
      </p>
      <p className="text-muted-foreground">
        This is useful for several scenarios: reports received through Slack or other messaging tools,
        historical data you want to backfill from older files, reports forwarded from colleagues
        outside the authorized sender list, or situations where you want to re-extract data from a
        document with updated metrics definitions.
      </p>
      <p className="text-muted-foreground">
        When you submit an import, the system processes it identically to an inbound email. The
        result appears in the Inbound list with the same status tracking, and any flagged items
        show up in the Review queue. You can import multiple reports in sequence without waiting
        for each one to finish.
      </p>
      <p className="text-muted-foreground">
        You can also paste data that covers multiple companies at once &mdash; for example, rows copied
        from a spreadsheet or CSV file containing metrics across your portfolio. The system will parse
        the data, create new companies if they don&apos;t already exist, add new metrics as needed, and
        populate values for existing companies and metrics. This makes it easy to bulk import historical
        data or onboard an entire portfolio in one step.
      </p>
      <p className="text-muted-foreground">
        Additionally, you can paste investment transaction data &mdash; rounds, proceeds, valuations,
        and share prices &mdash; and the AI will parse the entries and match them to your portfolio
        companies. This is useful for bulk-importing cap table history, backfilling historical rounds,
        or onboarding an entire portfolio&apos;s investment data at once. Transactions are written to
        each company&apos;s Investments section automatically.
      </p>
      <p className="text-muted-foreground">
        You can also paste fund-level cash flow data &mdash; commitments, capital calls, and
        distributions per portfolio group. Each row uses the format: date, group, type, amount,
        notes (optional). Type accepts full names (commitment, called_capital, distribution)
        or abbreviations (com, cc, dist). These cash flows power the computed LP metrics
        (TVPI, DPI, RVPI, Net IRR) shown on the Funds and Investments pages.
      </p>
      <p className="text-muted-foreground">
        Tip: for best results, include the company name and reporting period somewhere in the pasted
        text or attachment. The AI uses these cues to match the report to the correct company and
        assign the right period to extracted metrics.
      </p>
    </ExplainerContent>
  )
}
