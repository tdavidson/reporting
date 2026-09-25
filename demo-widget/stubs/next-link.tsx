import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { useAppNavigate } from '@/components/app-runtime'

/**
 * `next/link` for the widget bundle: an anchor that hands the href to the runtime's `navigate`.
 * Next-only props are swallowed so they never reach the DOM.
 */
type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname?: string }
  prefetch?: boolean | null
  replace?: boolean
  scroll?: boolean
  shallow?: boolean
  children?: ReactNode
}

export default function Link({ href, prefetch: _prefetch, replace: _replace, scroll: _scroll, shallow: _shallow, onClick, children, ...rest }: Props) {
  const navigate = useAppNavigate()
  const target = typeof href === 'string' ? href : (href.pathname ?? '/')
  return (
    <a
      href={target}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey) return
        e.preventDefault()
        navigate(target)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}
