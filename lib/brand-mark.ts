// The OtherAdmin mark: a disc cut by a diagonal, off-centre toward the top left, drawn as
// its two pieces. public/brand/otheradmin-mark.svg is the source; this is the same drawing
// for code that renders it inline (components/brand-mark.tsx) or as an image
// (app/api/pwa-icon). Its own module, free of imports, so a client component can take it.

export const MARK_PATHS = [
  'M353.61 54.39A224 224 0 0 0 54.39 353.61Z',
  'M404.08 87.92A224 224 0 1 1 87.92 404.08Z',
] as const

/** The mark's coordinate space. */
export const MARK_VIEWBOX = 512
