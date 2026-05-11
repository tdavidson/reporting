import { ogMetadata } from '@/lib/og-metadata'
import Image from 'next/image'
import { Building2 } from 'lucide-react'

export const metadata = ogMetadata({
  title: 'Portfolio',
  description: 'Monitor your fund with a dashboard of active companies, headline metrics, and shared team notes.',
})

export default function DashboardExplainerPage() {
  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-6 flex items-center gap-3">
        <Building2 className="h-6 w-6 text-muted-foreground" />
        Portfolio
      </h1>

      <Image
        src="/screenshots/dashboard.png"
        alt="Portfolio Dashboard"
        width={1200}
        height={900}
        className="w-full h-auto rounded-lg border shadow-sm mb-8"
        priority
      />

      <div className="space-y-4 text-sm leading-relaxed">
        <p className="text-muted-foreground">
          The Portfolio page is the main dashboard and your starting point for monitoring the fund.
          It shows all active companies with key headline metrics (such as MRR and cash balance) so you
          can quickly scan the health of the portfolio without clicking into individual companies.
          Companies are displayed as cards with their most recently reported figures.
        </p>
        <p className="text-muted-foreground">
          The dashboard also includes a shared notes section at the bottom where team members can post
          fund-level observations - market commentary, cross-portfolio themes, reminders for the
          next IC meeting, and so on. These notes are visible to everyone on the team.
        </p>
      </div>

      <h2 className="text-xl font-semibold tracking-tight mt-12 mb-6">Company Detail</h2>

      <Image
        src="/screenshots/company.png"
        alt="Company Detail"
        width={1200}
        height={900}
        className="w-full h-auto rounded-lg border shadow-sm mb-8"
      />

      <div className="space-y-4 text-sm leading-relaxed">
        <p className="text-muted-foreground">
          Click any company card to open its detail page. At the top you&apos;ll
          see the company name, headline metrics (like MRR and cash balance), and badges for stage,
          industry, and portfolio groups. Admins can click the edit button to update the company&apos;s
          name, aliases, stage, industry, founders, overview, and other details that give the AI more
          context for analysis.
        </p>
        <p className="text-muted-foreground">
          The main content area starts with the <strong>Analyst</strong> card. This is where you
          can generate an AI-powered summary of the company based on all available data - reported
          metrics, email content, uploaded documents, and any previous summaries. The AI acts as a
          senior analyst preparing a portfolio review memo: it highlights current performance, trends,
          strengths, risks, and follow-up questions. You can regenerate the summary at any time as new
          data comes in, clear it to start fresh, or upload additional context documents (board decks,
          strategy memos, investor updates) directly from this card to give the AI more to work with.
        </p>
        <p className="text-muted-foreground">
          Below the Analyst is the <strong>metrics section</strong>, where each metric has its own
          chart card. You can add new metrics directly from this page, or delete a metric and all its
          data from its card. Each chart shows data points over time, color-coded by confidence level
          (green for high, amber for medium, red for low) with manual entries shown as hollow circles.
          Click any data point on a chart to view or edit the full details. An export button at the top
          lets you download all metric data as a CSV.
        </p>
        <p className="text-muted-foreground">
          Further down the page, a <strong>documents section</strong> lists all files associated with
          the company - both files you&apos;ve uploaded and attachments from processed emails.
          These documents are available to the Analyst when generating summaries. A <strong>notes panel</strong> on
          the right side (or toggled via the chat button on mobile) lets your team leave company-specific
          observations visible to all members.
        </p>
        <p className="text-muted-foreground">
          The company page also includes an <strong>Investments</strong> section that tracks the
          fund&apos;s transaction history with that company. You can record investment rounds, proceeds
          from exits or distributions, and unrealized gain changes. The section displays summary
          metrics - total invested, current fair market value, MOIC, and total realized -
          along with a detailed transaction table.
        </p>
      </div>
    </div>
  )
}
