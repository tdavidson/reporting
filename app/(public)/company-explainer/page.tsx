import { Building2 } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export default function CompanyExplainerPage() {
  return (
    <ExplainerContent
      title="Company Detail"
      icon={Building2}
      screenshotSrc="/screenshots/company.png"
      screenshotLabel="Company Detail"
    >
      <p className="text-muted-foreground">
        Clicking a company on the Portfolio dashboard opens its detail page. At the top you&apos;ll
        see the company name, headline metrics (like MRR and cash balance), and badges for stage,
        industry, and portfolio groups. Admins can click the edit button to update the company&apos;s
        name, aliases, stage, industry, founders, overview, and other details that give the AI more
        context for analysis.
      </p>
      <p className="text-muted-foreground">
        The main content area starts with the <strong>Analyst</strong> card. This is where you
        can generate an AI-powered summary of the company based on all available data &mdash; reported
        metrics, email content, uploaded documents, and any previous summaries. The AI acts as a
        senior analyst preparing a portfolio review memo: it highlights current performance, trends,
        strengths, risks, and follow-up questions. You can regenerate the summary at any time as new
        data comes in, clear it to start fresh, or upload additional context documents (board decks,
        strategy memos, investor updates) directly from this card to give the AI more to work with.
        If your fund has multiple AI providers configured, a provider selector lets you choose
        which AI to use for each generation.
      </p>
      <p className="text-muted-foreground">
        Below the Analyst is the <strong>metrics section</strong>, where each metric has its own
        chart card. You can add new metrics directly from this page using the &ldquo;Add metric&rdquo;
        button, or delete a metric and all its data from its card. Each chart shows data points over
        time, color-coded by confidence level (green for high, amber for medium, red for low) with
        manual entries shown as hollow circles. Click any data point on a chart to open a popover
        where you can view the full details &mdash; period, value, confidence, source email, and
        notes &mdash; and edit or delete the value directly. You can also add data points manually
        using the &ldquo;Add&rdquo; button on each card, which is useful for entering historical data
        or correcting values. An export button at the top lets you download all metric data as a CSV.
      </p>
      <p className="text-muted-foreground">
        Further down the page, a <strong>documents section</strong> lists all files associated with
        the company &mdash; both files you&apos;ve uploaded and attachments from processed emails.
        These documents are available to the Analyst when generating summaries. Individual file
        uploads are limited to 20 MB per file. Finally, if the company has additional details like founders,
        contact emails, an overview, investment thesis, or a current business update, those appear
        at the bottom. A <strong>notes panel</strong> on
        the right side (or toggled via the chat button on mobile) lets your team leave company-specific
        observations visible to all members.
      </p>
      <p className="text-muted-foreground">
        The company page also includes an <strong>Investments</strong> section that tracks the
        fund&apos;s transaction history with that company. You can record investment rounds (with
        date, round name, amount invested, shares acquired, and cost per share), proceeds from
        exits or distributions (including escrowed amounts), and unrealized gain changes (current
        share price updates). The section displays summary metrics &mdash; total invested, current
        fair market value, MOIC, and total realized &mdash; along with a detailed transaction
        table. Admins can add, edit, and delete transactions directly from this panel. For exited
        companies the FMV reflects total realized proceeds; for written-off companies it shows zero;
        and for active companies it uses the latest share price multiplied by total shares held.
      </p>
    </ExplainerContent>
  )
}
