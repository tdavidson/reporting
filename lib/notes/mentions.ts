/**
 * Parse @mentions in note content and return matched user IDs.
 * Falls back to email prefix when display_name is missing.
 */
export function parseMentions(
  content: string,
  members: Array<{ user_id: string; display_name: string | null; email?: string }>
): string[] {
  return matchTaggedNames(
    content,
    members
      .map(m => {
        const name = m.display_name?.trim() || m.email?.split('@')[0]
        return name ? { id: m.user_id, name } : null
      })
      .filter((m): m is { id: string; name: string } => m !== null)
  )
}

/**
 * Parse @company mentions in note content and return matched company IDs.
 */
export function parseCompanyMentions(
  content: string,
  companies: Array<{ id: string; name: string }>
): string[] {
  return matchTaggedNames(
    content,
    companies.map(c => ({ id: c.id, name: c.name }))
  )
}

/**
 * Parse @group mentions in note content and return matched group names.
 */
export function parseGroupMentions(
  content: string,
  groups: string[]
): string[] {
  if (groups.length === 0) return []

  const sorted = [...groups].sort((a, b) => b.length - a.length)
  const escaped = sorted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(${escaped.join('|')})(?=[\\s,;!?]|$)`, 'gi')

  const matched = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const lower = match[1].toLowerCase()
    const original = groups.find(g => g.toLowerCase() === lower)
    if (original) matched.add(original)
  }

  return Array.from(matched)
}

/**
 * Match @Name patterns against a list of known names.
 * Builds a regex from the names (longest-first) and returns matched IDs.
 */
function matchTaggedNames(
  content: string,
  entries: Array<{ id: string; name: string }>
): string[] {
  if (entries.length === 0) return []

  const nameToId = new Map<string, string>()
  for (const e of entries) {
    nameToId.set(e.name.toLowerCase(), e.id)
  }

  const names = Array.from(nameToId.keys()).sort((a, b) => b.length - a.length)
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(${escaped.join('|')})(?=[\\s,;!?]|$)`, 'gi')

  const matched = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const id = nameToId.get(match[1].toLowerCase())
    if (id) matched.add(id)
  }

  return Array.from(matched)
}
