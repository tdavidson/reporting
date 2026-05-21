/**
 * Tolerant JSON extractor for AI responses.
 *
 * Models routinely wrap their JSON output in a code fence, prefix it with
 * commentary ("Here's the analysis:\n{...}"), or trail it with a sign-off.
 * Direct `JSON.parse` over the raw text fails in all of those cases. This
 * helper:
 *
 *   1. Strips a leading ```json / ``` fence if present
 *   2. Tries direct JSON.parse
 *   3. Falls back to slicing from the first `{` to its matching close brace
 *      (respecting strings and escape sequences) and parsing that
 *
 * Throws a descriptive Error including a 300-char prefix of the offending
 * text when no JSON object can be extracted.
 */
export function extractJsonObject(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    if (start === -1) throw new Error(`No JSON object in response: ${cleaned.slice(0, 300)}`)
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (inString) {
        if (escape) { escape = false; continue }
        if (ch === '\\') { escape = true; continue }
        if (ch === '"') { inString = false }
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          const slice = cleaned.slice(start, i + 1)
          try { return JSON.parse(slice) } catch {
            throw new Error(`JSON in response did not parse: ${slice.slice(0, 300)}`)
          }
        }
      }
    }
    throw new Error(`Unbalanced JSON in response: ${cleaned.slice(0, 300)}`)
  }
}
