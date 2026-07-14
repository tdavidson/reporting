import { ogMetadata } from '@/lib/og-metadata'
import { Calculator } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export const metadata = ogMetadata({
  title: 'Accounting',
  description: 'A double-entry ledger per vehicle: bank imports, capital calls and distributions, a monthly close that allocates to each partner, and LP capital account statements that tie to the books.',
})

export default function AccountingExplainerPage() {
  return (
    <ExplainerContent
      title="Accounting"
      icon={Calculator}
      screenshotSrc="/screenshots/funds.png"
      screenshotLabel="Accounting — financial statements: balance sheet and statement of operations derived from the ledger"
    >
      <p className="text-muted-foreground">
        Accounting gives each of your vehicles &mdash; a fund, an SPV, a direct deal, a GP entity
        &mdash; a real double-entry ledger, and turns it into the numbers your LPs actually see.
        It is entirely optional: turn it on for one vehicle, or none, and the rest of the platform
        works exactly as it did.
      </p>
      <p className="text-muted-foreground">
        <strong>Onboarding a vehicle</strong> - seed the chart of accounts, then choose how the
        books start: <em>full history</em>, rebuilding the ledger from inception out of your
        existing portfolio and LP data, or <em>cutover</em>, starting at a date with opening
        balances. GP and associate entities get their own chart &mdash; investment in fund,
        members&rsquo; capital, carried interest income &mdash; because they keep different books.
      </p>
      <p className="text-muted-foreground">
        <strong>Bank transactions</strong> - paste or upload a CSV export from your bank, Ramp, or
        QuickBooks. Columns are matched automatically, rows de-duplicated, and each becomes a
        balanced draft entry. AI suggests the account and entry type for a whole batch at once. An
        inflow can be booked as a <strong>capital call</strong> &mdash; funding one LP&rsquo;s open
        call, or split across every LP pro-rata by commitment &mdash; and an outflow as a{' '}
        <strong>distribution</strong>, split by capital balance so it lands in each partner&rsquo;s
        capital account rather than a pooled one. Nothing posts itself; every entry waits as a
        draft for you.
      </p>
      <p className="text-muted-foreground">
        <strong>Journal</strong> - every entry in plain double-entry form. Create, edit, post,
        unpost, void. A posted entry is never silently deleted, and an entry inside a closed period
        cannot be changed at all until the period is reopened &mdash; enforced in the database, not
        just in the app.
      </p>
      <p className="text-muted-foreground">
        <strong>Capital accounts</strong> - a per-partner roll-forward: beginning capital,
        contributions, distributions, management fees, expenses, income, realized and unrealized
        gains, FX translation, carried interest, ending capital. All of it derived from the ledger,
        so it always ties. Issue capital calls, track called, funded and unfunded per LP, and
        publish per-partner <strong>capital account statements</strong> as PDFs straight to the LP
        portal.
      </p>
      <p className="text-muted-foreground">
        <strong>LP capital events</strong> - not every vehicle needs full books. An SPV, a direct
        investment, or a fund whose administrator sends you a statement can instead record LP
        capital movements directly &mdash; by hand, or by pasting a spreadsheet. Those vehicles
        produce the same capital accounts, the same statements, and the same LP report as a
        fully-booked one, and can be promoted to a full ledger later.
      </p>
      <p className="text-muted-foreground">
        <strong>Allocation terms</strong> - how the close splits each category across partners: the
        allocation basis, each partner&rsquo;s commitment over time (effective-dated, including
        transfers between LPs), and who bears which category &mdash; a GP entity that pays no
        management fee, a side letter with a negotiated rate. Carry terms are set per vehicle: none,
        a straight split, or a European waterfall with a preferred return and catch-up.
      </p>
      <p className="text-muted-foreground">
        <strong>Period close</strong> - the single place allocation happens. Close <em>through</em> a
        date; the span splits into calendar months, and each is allocated and locked in turn, so gaps
        are impossible. The close allocates income and expenses to each partner&rsquo;s capital
        account, accrues <strong>interest on convertible notes</strong>, and accrues{' '}
        <strong>carried interest</strong> on unrealized gains &mdash; as if the fund liquidated at
        that period&rsquo;s NAV. That last part is what keeps every LP&rsquo;s reported NAV net of
        what the GP would actually take; without it, an LP&rsquo;s statement overstates what they
        would receive. Reopening a period reverses its allocation exactly, voiding rather than
        deleting.
      </p>
      <p className="text-muted-foreground">
        <strong>Schedule of investments</strong> - each position at cost and fair value, with its
        unrealized gain and its share of net assets, broken out by country, industry, and asset type.
        Rows come from your portfolio tracker and the ledger is the control total &mdash; any
        variance between the two is surfaced, never hidden.
      </p>
      <p className="text-muted-foreground">
        <strong>Financial statements</strong> - balance sheet (statement of assets, liabilities and
        partners&rsquo; capital), income statement, statement of cash flows, and statement of changes
        in partners&rsquo; capital. Books that don&rsquo;t balance are reported as a blocker, not
        buried.
      </p>
      <p className="text-muted-foreground">
        <strong>Live capital report</strong> - the LP report, derived from the books as of any date
        rather than frozen at import time, across every vehicle. A member who invests through your GP
        or associate entity is <strong>looked through</strong> to their share of what that entity
        holds: capital follows their ownership, carried interest follows their carry points, and the
        two are allowed to differ &mdash; a partner can hold carry points and no commitment at all.
        You can compare a live report against any stored snapshot, line by line, to see exactly where
        the two disagree.
      </p>
      <p className="text-muted-foreground">
        <strong>AI assistant</strong> - an assistant scoped to your books: interpret a statement,
        reconcile an account, draft an entry. It proposes; it never posts. Everything it produces
        lands as a draft for you to review. An API-key-authenticated agent endpoint (REST and MCP) is
        available if you want an external agent to work against your books.
      </p>
    </ExplainerContent>
  )
}
