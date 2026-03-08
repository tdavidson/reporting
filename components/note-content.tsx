'use client'

import { useMemo } from 'react'

interface Props {
  content: string
}

// Match @mentions: @ not inside an email (no word char or dot before it),
// followed by a word token, optionally more capitalized-word tokens for multi-word names
const MENTION_RE = /(?<![\w.])@([\w.]+(?:\s[A-Z][\w.]*)*)/g

/**
 * Renders note content with highlighted @mentions and preserved whitespace.
 */
export function NoteContent({ content }: Props) {
  const parts = useMemo(() => {
    const result: Array<{ type: 'text' | 'mention'; value: string }> = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    MENTION_RE.lastIndex = 0

    while ((match = MENTION_RE.exec(content)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: 'text', value: content.slice(lastIndex, match.index) })
      }
      result.push({ type: 'mention', value: match[0] })
      lastIndex = match.index + match[0].length
    }

    if (lastIndex < content.length) {
      result.push({ type: 'text', value: content.slice(lastIndex) })
    }

    return result
  }, [content])

  if (parts.length === 0) {
    return <p className="text-sm whitespace-pre-wrap">{content}</p>
  }

  return (
    <p className="text-sm whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.type === 'mention' ? (
          <span key={i} className="text-blue-600 dark:text-blue-400 font-medium">
            {part.value}
          </span>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </p>
  )
}
