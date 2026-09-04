import { redirect } from 'next/navigation'

/**
 * Plain-text authoring moved onto the journal page as a tab. Renders nothing, so it needs no
 * gate: the journal page it lands on gates both the entity and the caller.
 */
export default async function MancoTextLedgerRedirect(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  redirect(`/manco/${id}/journal?tab=text`)
}
