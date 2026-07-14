import { redirect } from 'next/navigation'

/**
 * The accounting section moved to /funds.
 *
 * The section's landing page is the fund overview now — performance per vehicle, derived
 * from the ledger — so the URL says what the nav says. This catch-all keeps every old deep
 * link working: /accounting/statements → /funds/statements, and so on.
 *
 * The API stays at /api/accounting/*. That is the service layer, not the page: it really is
 * the accounting API, and moving it would break the fund API keys and MCP configs already
 * pointed at it for no benefit a user would ever see.
 */
export default function AccountingRedirect({ params }: { params: { rest?: string[] } }) {
  const rest = params.rest?.length ? `/${params.rest.join('/')}` : ''
  redirect(`/funds${rest}`)
}
