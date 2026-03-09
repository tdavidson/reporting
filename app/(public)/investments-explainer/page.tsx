import { BarChart3 } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export default function InvestmentsExplainerPage() {
  return (
    <ExplainerContent
      title="Investments"
      icon={BarChart3}
      screenshotSrc="/screenshots/investments.png"
      screenshotLabel="Investments"
    >
      <p className="text-muted-foreground">
        The Investments page provides a fund-level view of all investment transactions across your portfolio.
        It aggregates data from each company&apos;s individual Investments section into a single table,
        showing total invested, current fair market value (FMV), MOIC, and total realized across the entire fund.
      </p>
      <p className="text-muted-foreground">
        On each <strong>company detail page</strong>, the Investments section tracks the fund&apos;s transaction
        history with that specific company. You can record investment rounds (with date, round name, amount invested,
        shares acquired, and cost per share), proceeds from exits or distributions (including escrowed amounts),
        and unrealized gain changes (current share price updates). Summary metrics &mdash; total invested,
        current FMV, MOIC, and total realized &mdash; are displayed above the transaction table.
      </p>
      <p className="text-muted-foreground">
        Admins can add, edit, and delete transactions directly. For exited companies the FMV reflects total
        realized proceeds; for written-off companies it shows zero; and for active companies it uses the latest
        share price multiplied by total shares held. Investment data can also be bulk-imported via the
        Import page by pasting transaction data from a spreadsheet.
      </p>
    </ExplainerContent>
  )
}
