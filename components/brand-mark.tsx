import { MARK_PATHS, MARK_VIEWBOX } from '@/lib/brand-mark'

/** The OtherAdmin mark, filled with currentColor so it follows the text colour and theme. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`} fill="currentColor" className={className}>
      {MARK_PATHS.map(d => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
