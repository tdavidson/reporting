import { ogMetadata } from '@/lib/og-metadata'
import { Crown } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export const metadata = ogMetadata({
  title: 'LPs',
  description: 'Track limited partner positions across snapshots, generate individual investor PDFs, and export to Excel.',
})

export default function LPsExplainerPage() {
  return (
    <ExplainerContent
      title="LPs"
      icon={Crown}
      screenshotSrc="/screenshots/lps.png"
      screenshotLabel="LPs snapshot - investor table with metrics, PDF export, and Excel download"
    >
      <p className="text-muted-foreground">
        LPs helps you track and report on your limited partner positions across snapshots.
        Import LP data from spreadsheets using AI-powered parsing, view aggregated metrics per
        investor, generate individual investor reports as PDFs, and export the full dataset to Excel.
      </p>
      <p className="text-muted-foreground">
        <strong>Snapshots</strong> - each snapshot represents LP positions at a point in time,
        typically a quarter-end. Create a new snapshot, then import data by pasting spreadsheet content.
        AI automatically matches columns to fields like investor name, entity, commitment, paid-in
        capital, distributions, NAV, DPI, RVPI, TVPI, and IRR.
      </p>
      <p className="text-muted-foreground">
        <strong>Investor table</strong> - the snapshot detail page shows all investors with
        aggregated metrics. Expand an investor to see individual entity and portfolio group line items.
        All values are inline-editable: click a row to edit metrics, or click an investor name to rename.
        Investors can be grouped under a parent for consolidated reporting, and duplicate investors
        can be merged together.
      </p>
      <p className="text-muted-foreground">
        <strong>Portfolio group filter</strong> - when a snapshot has multiple portfolio groups,
        a filter appears in the header to include or exclude specific groups from the view and totals.
      </p>
      <p className="text-muted-foreground">
        <strong>Report settings</strong> - configure a header and footer for the snapshot&apos;s
        PDF reports via the Settings button. These appear on individual investor PDFs and batch exports.
      </p>
      <p className="text-muted-foreground">
        <strong>Investor PDFs</strong> - click the document icon on any investor row to view their
        individual report, or use &ldquo;Batch PDFs&rdquo; to generate all investor reports at once.
        PDFs include the header, a metrics summary table, and the footer.
      </p>
      <p className="text-muted-foreground">
        <strong>Excel export</strong> - export the full snapshot dataset to an Excel file with
        all investors, entities, portfolio groups, and metrics.
      </p>
    </ExplainerContent>
  )
}
