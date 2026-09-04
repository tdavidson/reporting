import { redirect } from 'next/navigation'

/**
 * The management company section moved into Entities.
 *
 * A management company is a vehicle in `fund_vehicles` like any other, so it is now addressed
 * like any other — `/funds/<id>/journal`, not `/manco/<id>/journal` — and the pages it shares
 * with the funds are literally the same pages rather than a parallel set that had to be kept in
 * step. What made it a section of its own was that its books need a grant of their own, and that
 * has not changed: `requireVehicleAccess` refuses a management company to a caller holding only
 * `accounting`, and `assertVehicleDomain` refuses it to every API. The boundary is the entity's
 * kind, which is where it always really was — not the URL prefix.
 *
 * This catch-all keeps every old link working: /manco → /funds, /manco/<id>/journal →
 * /funds/<id>/journal. It renders nothing, so it needs no gate — the page it lands on gates both
 * the caller and the entity.
 */
export default async function MancoRedirect(props: { params: Promise<{ rest?: string[] }> }) {
  const params = await props.params
  const rest = params.rest?.length ? `/${params.rest.join('/')}` : ''
  redirect(`/funds${rest}`)
}
