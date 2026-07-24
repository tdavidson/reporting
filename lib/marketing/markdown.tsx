import React from 'react'

// Minimal inline markdown: [label](href) links and **bold**. Everything else is plain
// text (React escapes it, so raw HTML in the JSON can't inject). Deliberately not a full
// markdown parser — the marketing JSON only needs links and emphasis.
const TOKEN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*/g

export function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null
  const nodes: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[1] && m[2]) {
      nodes.push(
        <a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
          {m[1]}
        </a>
      )
    } else if (m[3]) {
      nodes.push(<strong key={key++}>{m[3]}</strong>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}
