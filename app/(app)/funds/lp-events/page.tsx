import { redirect } from 'next/navigation'

// LP capital events used to be their own destination. They are not: they are one of the two
// producers a capital account reads from, so they now live ON the Capital accounts page, and
// only for a vehicle that actually uses them (capital_source='events'). A fully-booked vehicle
// ignores anything entered as an event, so offering the page for one was an invitation to
// enter capital that would never be read.
//
// The route is kept as a redirect so existing links and bookmarks land somewhere useful.
export default function LpEventsPage() {
  redirect('/funds/capital-accounts')
}
