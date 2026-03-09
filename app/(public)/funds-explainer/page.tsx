import { Briefcase } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export default function FundsExplainerPage() {
  return (
    <ExplainerContent
      title="Funds"
      icon={Briefcase}
      screenshotSrc="/screenshots/funds.png"
      screenshotLabel="Funds"
    >
      <p className="text-muted-foreground">
        The Funds page provides fund-level LP metrics computed from cash flow data. Each portfolio
        group gets its own tab showing committed capital, called capital (paid-in capital), uncalled
        capital, distributions, gross residual value, estimated carry, net residual value, and total
        value &mdash; along with calculated TVPI, DPI, RVPI, and Net IRR.
      </p>
      <p className="text-muted-foreground">
        Cash flows are recorded per portfolio group with three types: <strong>commitments</strong> (capital
        committed by LPs), <strong>called capital</strong> (capital actually called from LPs), and
        <strong> distributions</strong> (capital returned to LPs). Each tab shows a chronological table
        of cash flows with running cumulative totals for committed, called, uncalled, and distributed amounts.
      </p>
      <p className="text-muted-foreground">
        The LP metrics are calculated automatically: TVPI (total value to paid-in capital), DPI (distributions
        to paid-in capital), RVPI (net residual value to paid-in capital), and Net IRR (using XIRR with
        capital calls as negative flows, distributions as positive, and net residual as a terminal value).
        Estimated carry is computed as 20% of profit above remaining invested capital.
      </p>
      <p className="text-muted-foreground">
        Cash flows can be added individually from the Funds page or bulk-imported via the Import page
        by pasting tab or comma-separated data. The same computed metrics also appear in the group summary
        table on the Investments page.
      </p>
    </ExplainerContent>
  )
}
