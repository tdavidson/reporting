/**
 * Shared validators for deal submissions, used by both the public submit form
 * (`/api/public/submit/[token]`) and the admin manual entry endpoint
 * (`/api/deals/manual`). Same hardening applies to both paths:
 *   - finite caps on text fields
 *   - URL scheme allowlist (http/https only)
 *   - attachment MIME + extension allowlists
 *
 * The public endpoint already trusts none of its input. The admin endpoint
 * applies the same checks as defense-in-depth — an admin can typo a
 * `javascript:` URL or attach a `.html` file just as easily as anyone else.
 */

export const MAX_NAME_LEN = 200
export const MAX_EMAIL_LEN = 254          // RFC 5321
export const MAX_URL_LEN = 1000
export const MAX_PITCH_LEN = 50_000

// Only accept attachment content types we actually parse. The deal-detail page
// downloads attachments using the stored ContentType — letting a submitter set
// `text/html` would let them render arbitrary HTML in a partner's
// authenticated session. Same goes for SVG (script-bearing) and anything
// ambiguous. Keep this list tight.
export const ALLOWED_ATTACHMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',// .pptx
  'application/msword',                                                       // legacy .doc
  'application/vnd.ms-excel',                                                 // legacy .xls
  'application/vnd.ms-powerpoint',                                            // legacy .ppt
  'text/plain',
])

export const ALLOWED_ATTACHMENT_EXTS = new Set([
  'pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'txt',
])

/** Stricter than `s.includes('@')`. Rejects obvious garbage; RFC 5322 is byzantine and not worth fully enforcing. */
export const EMAIL_RE = /^[^\s<>@,;:\\"\[\]()]+@[^\s<>@,;:\\"\[\]()]+\.[^\s<>@,;:\\"\[\]()]+$/

/** Sanitize a filename: strip path separators + control characters, collapse `..`, cap length. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_').slice(0, 200)
}

/** Extract the lowercased extension from a filename, or empty string. */
export function fileExt(name: string): string {
  return (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
}

/**
 * Accept only `http(s)` URLs. Reject `javascript:`, `data:`, `file:`,
 * `vbscript:`, etc. Returns the normalized URL on success, null on failure.
 * If the input is missing a scheme, prepends `https://` and re-parses.
 */
export function safeWebUrl(input: string): string | null {
  try {
    const u = new URL(input)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    try {
      const u = new URL(`https://${input}`)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      return u.toString()
    } catch {
      return null
    }
  }
}

export interface AttachmentValidationError { code: 'mime' | 'ext'; message: string }

/**
 * Validate an attachment's MIME + extension against the allowlists.
 * Returns null on success or an error object describing why it was rejected.
 */
export function validateAttachmentType(filename: string, contentType: string): AttachmentValidationError | null {
  if (!ALLOWED_ATTACHMENT_MIMES.has(contentType)) {
    return { code: 'mime', message: 'Unsupported attachment type. Allowed: PDF, Word, Excel, PowerPoint, plain text.' }
  }
  if (!ALLOWED_ATTACHMENT_EXTS.has(fileExt(filename))) {
    return { code: 'ext', message: 'Unsupported file extension.' }
  }
  return null
}
