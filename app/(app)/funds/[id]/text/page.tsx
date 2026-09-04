import { redirect } from 'next/navigation'

/**
 * Plain-text authoring moved onto the journal page as a tab. This keeps the old URL working —
 * the docs and a few bookmarks pointed here — and renders nothing itself, so it needs no gate:
 * the journal page it lands on gates the vehicle.
 */
export default async function TextLedgerRedirect(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  redirect(`/funds/${id}/journal?tab=text`)
}
