import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderInlineMarkdown } from './markdown'

const html = (text: string) => renderToStaticMarkup(<>{renderInlineMarkdown(text)}</>)

describe('renderInlineMarkdown', () => {
  it('renders a link', () => {
    const out = html('see [docs](https://example.com) now')
    expect(out).toContain('<a')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('>docs</a>')
    expect(out).toContain('see ')
    expect(out).toContain(' now')
  })

  it('renders bold', () => {
    expect(html('a **bold** word')).toContain('<strong>bold</strong>')
  })

  it('escapes raw HTML (no injection)', () => {
    const out = html('hi <img src=x onerror=alert(1)>')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('passes plain text through', () => {
    expect(html('just text')).toContain('just text')
  })
})
