import { describe, expect, it } from 'vitest'
import { sanitizeLetterHtml } from './sanitize'

/**
 * SEC-004. The first case is the one that was actually live: the old regex only neutralized
 * dangerous schemes inside QUOTED attribute values, so removing the quotes was the whole bypass.
 * The rest of this file is the class that bug belonged to — every way an attacker can make the
 * HTML parser and a regular expression disagree about where an attribute starts and stops.
 *
 * The realistic writer is an insider or a compromised member account writing `lp_letters` straight
 * through the Data API; the reader is an LP. SEC-002 narrowed who can write that row, and this is
 * what stops the row from mattering if they do.
 */

const clean = (html: string) => sanitizeLetterHtml(html) ?? ''

describe('the bypass that shipped', () => {
  it('strips an UNQUOTED javascript: href — the old regex required quotes and missed this', () => {
    const out = clean('<a href=javascript:alert(1)>click</a>')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('click')
  })

  it('still strips the quoted form the old regex did catch', () => {
    expect(clean('<a href="javascript:alert(1)">click</a>')).not.toContain('javascript:')
    expect(clean("<a href='javascript:alert(1)'>click</a>")).not.toContain('javascript:')
  })
})

describe('scheme smuggling', () => {
  it.each([
    ['mixed case', '<a href="JaVaScRiPt:alert(1)">x</a>'],
    ['leading whitespace', '<a href="  javascript:alert(1)">x</a>'],
    ['embedded tab', '<a href="java\tscript:alert(1)">x</a>'],
    ['embedded newline', '<a href="java\nscript:alert(1)">x</a>'],
    ['embedded null', '<a href="java\0script:alert(1)">x</a>'],
    ['html entity', '<a href="&#106;avascript:alert(1)">x</a>'],
    ['hex entity', '<a href="&#x6a;avascript:alert(1)">x</a>'],
    ['vbscript', '<a href="vbscript:msgbox(1)">x</a>'],
    ['data url', '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>'],
  ])('drops %s', (_label, payload) => {
    const out = clean(payload).toLowerCase().replace(/[\s\0]/g, '')
    expect(out).not.toMatch(/javascript:|vbscript:|data:text\/html/)
  })

  it('keeps the schemes a letter legitimately links with', () => {
    expect(clean('<a href="https://example.com">x</a>')).toContain('https://example.com')
    expect(clean('<a href="mailto:lp@example.com">x</a>')).toContain('mailto:lp@example.com')
  })

  it('sends surviving links out with opener and referrer closed off', () => {
    const out = clean('<a href="https://example.com">x</a>')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
    expect(out).toContain('target="_blank"')
  })
})

describe('script execution vectors', () => {
  it.each([
    ['script tag', '<script>alert(1)</script>'],
    ['unclosed script', '<script>alert(1)'],
    ['nested/split script', '<scr<script>ipt>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['body onload', '<body onload=alert(1)>'],
    ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ['object data', '<object data="javascript:alert(1)"></object>'],
    ['embed', '<embed src="javascript:alert(1)">'],
    ['form action', '<form action="javascript:alert(1)"><input></form>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
    ['base href', '<base href="javascript:alert(1)//">'],
    ['link import', '<link rel="import" href="javascript:alert(1)">'],
  ])('removes %s', (_label, payload) => {
    const out = clean(payload).toLowerCase()
    expect(out).not.toMatch(/<script|onerror|onload|javascript:|<iframe|<object|<embed|<form|<meta|<base|<link/)
  })
})

describe('the allowlist is actually in effect', () => {
  // This is the regression test for a config mistake, not for a payload. DOMPurify treats
  // `USE_PROFILES` as an ALTERNATIVE to `ALLOWED_TAGS` rather than an addition, so setting both
  // made the profile win and quietly re-admitted every HTML tag. Nothing about the config looked
  // wrong; only the output did.
  it.each(['img', 'video', 'audio', 'input', 'button', 'select', 'textarea', 'canvas'])(
    'drops <%s>, which is not on the allowlist',
    tag => {
      expect(clean(`<${tag} src="x">text</${tag}>`).toLowerCase()).not.toContain(`<${tag}`)
    },
  )

  it('keeps the element content when it drops the element', () => {
    // KEEP_CONTENT: a disallowed wrapper should not take the letter's words with it.
    expect(clean('<img src=x>')).toBe('')
    expect(clean('<button>Quarterly results</button>')).toContain('Quarterly results')
    expect(clean('<marquee>Quarterly results</marquee>')).toContain('Quarterly results')
  })

  it('takes the content WITH the element for the few tags where text is not text', () => {
    // DOMPurify's FORBID_CONTENTS defaults — script, style, svg, math, video, audio, template and
    // friends. Keeping their children would mean re-parenting bytes that were never markup into a
    // context where they are, which is its own bypass. Asserted so the distinction is deliberate.
    expect(clean('<video>Quarterly results</video>')).toBe('')
    expect(clean('<style>body{}</style>')).toBe('')
  })

  it('reads an unquoted src with a slash as ONE attribute value, the way a parser does', () => {
    // `<img src=x/onerror=alert(1)>` has no onerror attribute at all — `/` is legal inside an
    // unquoted value, so the whole thing is the src. The old regex sanitizer had a special case
    // for this precisely because it was guessing at attribute boundaries; a parser does not need
    // one. The img is dropped here for being off the allowlist, not for the handler.
    expect(clean('<img src=x/onerror=alert(1)>')).toBe('')
  })
})

describe('foreign content and namespace confusion', () => {
  // SVG and MathML switch the parser into a different content model, which is where "the regex and
  // the browser disagree" stops being theoretical.
  it.each([
    ['svg script', '<svg><script>alert(1)</script></svg>'],
    ['svg onload', '<svg onload=alert(1)></svg>'],
    ['svg animate', '<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg>'],
    ['svg foreignObject', '<svg><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject></svg>'],
    ['mathml annotation', '<math><annotation-xml encoding="text/html"><script>alert(1)</script></annotation-xml></math>'],
    ['xlink href', '<svg><use xlink:href="javascript:alert(1)"/></svg>'],
  ])('neutralizes %s', (_label, payload) => {
    const out = clean(payload).toLowerCase()
    expect(out).not.toMatch(/<script|onload|javascript:|<iframe|<animate|<foreignobject/)
  })
})

describe('malformed markup', () => {
  it.each([
    ['stray lt', '<<script>alert(1)</script>'],
    ['unterminated attribute', '<a href="javascript:alert(1)>click'],
    ['comment smuggling', '<!--<script>alert(1)</script>-->'],
    ['cdata', '<![CDATA[<script>alert(1)</script>]]>'],
    ['null in tag name', '<scr\0ipt>alert(1)</scr\0ipt>'],
    ['attribute without value', '<div onmouseover>x</div>'],
  ])('does not emit anything executable from %s', (_label, payload) => {
    const out = clean(payload).toLowerCase()
    expect(out).not.toMatch(/<script|onmouseover|javascript:/)
  })

  it('returns a string for input a parser cannot make sense of', () => {
    expect(typeof clean('<<<>>>')).toBe('string')
    expect(typeof clean('&&&;;;')).toBe('string')
  })
})

describe('style attributes', () => {
  // A `<td>` has to be wrapped: parsing one outside a table drops it, because that is what the
  // HTML spec says a browser does with an orphan cell. The sanitizer is a parser now, so it
  // inherits that — worth knowing before reading a stripped cell as a sanitizer bug.
  const cell = (style: string, text = '1') => clean(`<table><tbody><tr><td style="${style}">${text}</td></tr></tbody></table>`)

  it('keeps the two declarations the generator actually emits', () => {
    expect(cell('text-align:right')).toContain('text-align:right')
    expect(cell('text-transform:capitalize', 'a')).toContain('text-transform:capitalize')
  })

  it('drops declarations that are not on the allowlist, keeping the ones that are', () => {
    const out = cell('text-align:right;position:fixed;top:0;z-index:9999')
    expect(out).toContain('text-align:right')
    expect(out).not.toMatch(/position|z-index/)
  })

  it.each([
    ['url()', '<div style="background:url(javascript:alert(1))">x</div>'],
    ['expression()', '<div style="width:expression(alert(1))">x</div>'],
    ['-moz-binding', '<div style="-moz-binding:url(http://evil/x.xml#y)">x</div>'],
    ['behavior', '<div style="behavior:url(#default#time2)">x</div>'],
  ])('drops %s entirely', (_label, payload) => {
    const out = clean(payload).toLowerCase()
    expect(out).not.toMatch(/javascript:|expression|binding|behavior|url\(/)
  })

  it('removes the attribute rather than leaving an empty one', () => {
    const out = cell('position:fixed')
    expect(out).toContain('<td>')
    expect(out).not.toContain('style=')
  })
})

describe('the portfolio table survives intact', () => {
  // The generator's own output (lib/lp-letters/generate.ts). A sanitizer that mangles this is a
  // broken letter, which is how sanitizers get quietly removed again.
  const table = `<table>
  <thead><tr><th>Company</th><th style="text-align:right">Invested</th></tr></thead>
  <tbody><tr><td>Acme</td><td style="text-align:right">$1.2M</td></tr>
  <tr><td style="text-transform:capitalize">active</td><td>—</td></tr></tbody>
  <tfoot><tr><td colspan="3"><strong>Total</strong></td><td style="text-align:right"><strong>$1.2M</strong></td></tr></tfoot>
</table>`

  it('keeps every structural tag', () => {
    const out = clean(table)
    for (const tag of ['<table', '<thead', '<tbody', '<tfoot', '<tr', '<th', '<td', '<strong']) {
      expect(out, `${tag} was stripped`).toContain(tag)
    }
  })

  it('keeps colspan, the alignment styles, and the escaped content', () => {
    const out = clean(table)
    expect(out).toContain('colspan="3"')
    expect(out).toContain('text-align:right')
    expect(out).toContain('text-transform:capitalize')
    expect(out).toContain('Acme')
    expect(out).toContain('$1.2M')
    expect(out).toContain('—')
  })

  it('leaves entity-escaped company names escaped, not executable', () => {
    const out = clean('<td>&lt;script&gt;alert(1)&lt;/script&gt;</td>')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;script&gt;')
  })
})

describe('null handling', () => {
  it('passes null and undefined through so "no table" stays distinct from "empty table"', () => {
    expect(sanitizeLetterHtml(null)).toBeNull()
    expect(sanitizeLetterHtml(undefined)).toBeNull()
    expect(sanitizeLetterHtml('')).toBe('')
  })
})
