import { ogMetadata } from '@/lib/og-metadata'
import { ShieldCheck } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export const metadata = ogMetadata({
  title: 'Compliance',
  description: 'Track regulatory filings, tax deadlines, and compliance obligations with a calendar tailored to your fund.',
})

export default function ComplianceExplainerPage() {
  return (
    <ExplainerContent
      title="Compliance"
      icon={ShieldCheck}
      screenshotSrc="/screenshots/compliance.png"
      screenshotLabel="Compliance"
    >
      <p className="text-muted-foreground">
        Compliance helps venture capital fund managers stay on top of regulatory filings, tax
        deadlines, internal compliance requirements, and fund reporting obligations. It provides
        a calendar-based view of everything due throughout the year, tailored to your fund&apos;s
        specific profile.
      </p>

      <p className="text-muted-foreground">
        <strong>Compliance profile</strong> - answer a short questionnaire about your fund
        (registration status, AUM range, fund structure, Reg D exemption, state presence, etc.)
        and the system automatically determines which compliance items apply to your fund, which
        need further review, and which you can safely dismiss.
      </p>

      <p className="text-muted-foreground">
        <strong>Calendar view</strong> - all applicable compliance items are displayed in a
        monthly calendar organized by deadline. Items are color-coded by category: SEC filings in
        amber, tax filings in green, internal compliance in blue, fund reporting in purple, state
        compliance in rose, CFTC in orange, and AML/FinCEN in red. Quarterly items like partnership
        expense reviews and access person disclosures appear in each quarter independently, so you
        can track and dismiss them separately.
      </p>

      <p className="text-muted-foreground">
        <strong>Event-driven items</strong> - filings like Form D and Blue Sky that are
        triggered by fund closes appear only in the months where your fund has committed capital
        entries, rather than cluttering every month. This is derived automatically from your fund
        cash flows data.
      </p>

      <p className="text-muted-foreground">
        <strong>Dismiss and filter</strong> - mark items as done for the year (or quarter)
        by dismissing them. Filter the view between active items, dismissed items, or all items to
        see what&apos;s been completed and what remains.
      </p>

      <p className="text-muted-foreground">
        <strong>All items view</strong> - a comprehensive list of every compliance item
        organized by category (SEC Filings, Tax Filings, Internal Compliance, Fund Reporting,
        Securities Offerings, State Compliance, CFTC, and AML/FinCEN). Each item shows its
        frequency, deadline, applicability, filing system, and any relevant notes or alerts. Click
        any item to see full details including regulation links, filing portal links, and your
        saved reference links.
      </p>

      <p className="text-muted-foreground">
        <strong>Links &amp; accounts</strong> - save links to filing portals, regulatory
        accounts, and reference documents. Each link can optionally be associated with a specific
        compliance item, and associated links appear on that item&apos;s detail card for quick access.
      </p>

      <p className="text-muted-foreground">
        <strong>Built-in compliance registry</strong> - the system ships with a curated
        registry of compliance items covering SEC filings (Form ADV, Form PF, Form 13F, Schedule
        13G, Form 13H, Form N-PX), securities offerings (Form D, Blue Sky), CFTC exemptions,
        California diversity reporting, tax filings (Form 1065, K-1s, Form 7004), internal
        compliance (access person disclosures, annual compliance review, privacy notice), AML/FinCEN
        requirements, fund reporting (quarterly financials, valuations), and partnership expense
        allocation. Each item includes detailed descriptions, deadline information, applicability
        criteria, and links to relevant regulations and filing portals.
      </p>
    </ExplainerContent>
  )
}
