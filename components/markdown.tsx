'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Markdown, rendered with the app's own type scale and tokens.
 *
 * This exists because `prose` does not. Every `prose-*` class in this repo is inert —
 * @tailwindcss/typography was never installed — so an Analyst answer that came back as a tidy
 * markdown document (headings, bullets, bold company names, a table) rendered as one undifferentiated
 * wall of body text with the odd horizontal rule. The fix is not to add the plugin and then spend
 * the same effort overriding its colours back onto tokens: it is to say what each element looks
 * like, once, here.
 *
 * `remark-gfm` is on because the answers are financial: tables are the natural shape for
 * "here is every company and its runway", and without it they arrive as rows of pipe characters.
 *
 * Numbers in a table get `tabular-nums`, not `font-mono` — see CLAUDE.md. Figures are not code.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed space-y-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // The document inside a chat turn is a section of the page, not the page: the top
          // heading level lands at the size of a card title and steps down from there, so an
          // answer never out-shouts the page's own h1.
          h1: ({ children }) => (
            <h2 className="mt-6 first:mt-0 text-lg font-semibold tracking-tight">{children}</h2>
          ),
          h2: ({ children }) => (
            <h3 className="mt-6 first:mt-0 text-base font-semibold tracking-tight">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-5 first:mt-0 text-sm font-semibold">{children}</h4>
          ),
          h4: ({ children }) => (
            <h5 className="mt-4 first:mt-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h5>
          ),
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          // `space-y-1.5` rather than a margin on the item, so a nested list does not double up.
          ul: ({ children }) => <ul className="list-disc space-y-1.5 pl-5 marker:text-muted-foreground">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1.5 pl-5 marker:text-muted-foreground">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed [&>ul]:mt-1.5 [&>ol]:mt-1.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
          ),
          // Mono here is correct and consistent with the rule: code is content a machine reads literally.
          code: ({ className, children }) => {
            // react-markdown hands fenced blocks a `language-*` class and inline code none.
            const fenced = typeof className === 'string' && className.startsWith('language-')
            if (fenced) return <code className="font-mono text-xs">{children}</code>
            return <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-card border bg-muted/50 p-3 text-xs">{children}</pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-700 underline underline-offset-2 hover:no-underline dark:text-brand-400"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="border-border" />,
          // Tables scroll inside their own box rather than widening the thread.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs tabular-nums">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b">{children}</thead>,
          th: ({ children }) => (
            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-border/50 px-2 py-1.5 align-top">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
