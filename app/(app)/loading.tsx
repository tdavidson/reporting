/**
 * What every page in the app shows while its server component is still running.
 *
 * There was no loading boundary anywhere in this app, and on a phone that is most of
 * what "slow" meant. Without one, tapping a tab does NOTHING visible: the router holds
 * the old page on screen, fully interactive-looking, until the new page's data has been
 * fetched and rendered on the server — auth, membership, access context, then the
 * page's own queries. The wait is real either way; the difference is whether the app
 * acknowledges the tap. It now does, on the next frame.
 *
 * It buys a second thing that is not obvious: in the App Router a `<Link>` to a DYNAMIC
 * route prefetches only as far as the nearest loading boundary, so with none in the
 * tree, prefetching every one of these pages fetched nothing at all. The phone's tab
 * bar sits in the viewport on every page, so its four destinations now warm their shell
 * ahead of the tap.
 *
 * Deliberately generic. The app's pages share a shape — title, a row of figures, a
 * table — and a skeleton that matches the shape of the page you are ARRIVING at is
 * worth more than one that matches nothing. It is not trying to be a fake of any
 * particular page: the blocks are unlabelled, and short enough that the real content
 * replacing them does not read as a jump.
 */
export default function AppLoading() {
  return (
    // aria-busy + a live region: a skeleton is a visual signal only, and a screen
    // reader would otherwise be told nothing at all until the page swaps in.
    <div className="pt-4 md:pt-8 pb-8 px-4 w-full animate-pulse" aria-busy="true" role="status">
      <span className="sr-only">Loading</span>

      <div className="h-7 w-40 rounded-md bg-muted" />
      <div className="mt-3 h-4 w-64 max-w-full rounded-md bg-muted/70" />

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rounded-card border border-border p-3">
            <div className="h-3 w-16 rounded bg-muted/70" />
            <div className="mt-2 h-6 w-24 max-w-full rounded bg-muted" />
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-card border border-border divide-y divide-border">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex items-center justify-between gap-4 px-3 py-3.5">
            <div className="h-4 w-1/2 rounded bg-muted" />
            <div className="h-4 w-14 shrink-0 rounded bg-muted/70" />
          </div>
        ))}
      </div>
    </div>
  )
}
