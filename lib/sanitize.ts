import DOMPurify from 'isomorphic-dompurify'

/**
 * Allowlist sanitization for GP-authored letter HTML, which is rendered into LP browsers through
 * `dangerouslySetInnerHTML`.
 *
 * WHAT WAS WRONG (SEC-004). The previous implementation was a chain of regular expressions, and it
 * neutralized dangerous URI schemes only inside QUOTED attribute values:
 *
 *     .replace(/(href|src)\s*=\s*"(?:\s*(?:javascript|vbscript|data)\s*:)[^"]*"/gi, …)
 *
 * so `<a href="javascript:alert(1)">` was caught and `<a href=javascript:alert(1)>` — the same
 * thing without quotes, which HTML permits — went through untouched and was then rendered. Regex
 * cannot do this job: it has to agree with a browser's HTML parser about where an attribute
 * begins and ends, and it never will. Every bypass in this class comes from that disagreement —
 * unquoted values, entity-encoded schemes, embedded newlines and nulls, `<svg>` and MathML
 * foreign-content switches, namespace confusion, mixed case.
 *
 * So this parses instead of pattern-matching. DOMPurify builds a real DOM, walks it, and keeps only
 * what is named below; anything unrecognised is dropped rather than rewritten. It runs in the
 * browser and in Node from the same import, which matters because one of the four call sites is a
 * client component (app/(app)/letters/[id]/page.tsx).
 *
 * WHAT IS ALLOWED is deliberately close to what `buildPortfolioTableHtml` actually emits
 * (lib/lp-letters/generate.ts): a table, `colspan`, `<strong>`, and two inline styles. The letter
 * body itself is stored separately as `full_draft` and rendered as TEXT, so nothing here needs to
 * support rich prose.
 *
 * WHERE IT RUNS: at persistence (the generate route) and again at every render/serve boundary. Both
 * ends, because the threat model is a row written directly through the Data API rather than a bad
 * generator — SEC-002 narrowed who can do that, but "narrowed" is not "nobody".
 */

/** Schemes an `href` may use. Everything else — javascript:, data:, vbscript:, file: — is dropped. */
const ALLOWED_URI = /^(?:https?:|mailto:|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i

/**
 * CSS declarations that survive on a `style` attribute.
 *
 * An allowlist rather than a filter: `style` is an injection surface of its own (`url(...)`,
 * `expression(...)`, `-moz-binding`), and the generator only ever needs alignment. A declaration
 * that is not exactly one of these is discarded, not repaired.
 */
const ALLOWED_STYLE: Record<string, RegExp> = {
  'text-align': /^(left|right|center|justify)$/,
  'text-transform': /^(capitalize|uppercase|lowercase|none)$/,
  'font-weight': /^(normal|bold|[1-9]00)$/,
  'vertical-align': /^(top|middle|bottom|baseline)$/,
  'white-space': /^(nowrap|normal|pre-wrap)$/,
}

const CONFIG = {
  ALLOWED_TAGS: [
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'p', 'br', 'div', 'span', 'strong', 'em', 'b', 'i', 'u', 'small',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'a',
  ],
  ALLOWED_ATTR: ['colspan', 'rowspan', 'style', 'href', 'title', 'scope', 'align'],
  ALLOWED_URI_REGEXP: ALLOWED_URI,
  // Redundant with the allowlist above — nothing not in ALLOWED_TAGS survives anyway — but stated
  // so that widening ALLOWED_TAGS later cannot quietly readmit them.
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form',
                'svg', 'math', 'template', 'noscript'],
  // NO `USE_PROFILES` HERE, deliberately. DOMPurify treats it as an ALTERNATIVE to ALLOWED_TAGS,
  // not an addition: setting both makes the profile win and silently widens the allowlist back to
  // all of HTML. The first version of this file set `USE_PROFILES: { html: true }` alongside the
  // list above, and `<img src=x onerror=…>` sailed through — caught only because a test asserted
  // on the output rather than on the config. Foreign content is excluded by ALLOWED_TAGS omitting
  // svg/math and FORBID_TAGS naming them, which is enough.
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  KEEP_CONTENT: true,
}

/**
 * DOMPurify hands hooks a DOM node, but WHICH DOM depends on where this runs: the browser's in a
 * client component, jsdom's under Node. `instanceof Element` is true in one and a ReferenceError in
 * the other, since Node has no such global. So the check is structural.
 */
interface AttributedNode {
  nodeType: number
  tagName?: string
  hasAttribute(name: string): boolean
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

const ELEMENT_NODE = 1

function asElement(node: unknown): AttributedNode | null {
  const candidate = node as AttributedNode | null
  return candidate && candidate.nodeType === ELEMENT_NODE && typeof candidate.getAttribute === 'function'
    ? candidate
    : null
}

/**
 * Reduce a `style` attribute to the declarations named in ALLOWED_STYLE.
 *
 * A hook rather than a pre-pass: it runs after DOMPurify has parsed the document, so it sees the
 * attribute the browser sees rather than a guess at where the quotes were.
 */
DOMPurify.addHook('afterSanitizeAttributes', node => {
  const element = asElement(node)
  if (!element || !element.hasAttribute('style')) return

  const kept = element
    .getAttribute('style')!
    .split(';')
    .map(declaration => {
      const index = declaration.indexOf(':')
      if (index === -1) return null
      const property = declaration.slice(0, index).trim().toLowerCase()
      const value = declaration.slice(index + 1).trim().toLowerCase()
      const allowed = ALLOWED_STYLE[property]
      return allowed && allowed.test(value) ? `${property}:${value}` : null
    })
    .filter((declaration): declaration is string => declaration !== null)

  if (kept.length) element.setAttribute('style', kept.join(';'))
  else element.removeAttribute('style')
})

/**
 * An `<a>` that survives sanitization still opens in the LP's tab and still hands the destination a
 * `window.opener`. Letters are read by people who did not write them, so links leave with the
 * usual mitigations attached.
 */
DOMPurify.addHook('afterSanitizeAttributes', node => {
  const element = asElement(node)
  if (element && element.tagName === 'A' && element.hasAttribute('href')) {
    element.setAttribute('target', '_blank')
    element.setAttribute('rel', 'noopener noreferrer nofollow')
  }
})

/**
 * Sanitize letter HTML for storage or for rendering.
 *
 * Null and undefined pass through unchanged so the call sites can keep treating "no table" as a
 * distinct state from "an empty table".
 */
export function sanitizeLetterHtml(html: string | null | undefined): string | null {
  if (!html) return html ?? null
  return DOMPurify.sanitize(html, CONFIG)
}
