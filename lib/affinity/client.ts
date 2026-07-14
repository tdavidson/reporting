/**
 * Affinity REST client (API v1).
 *
 * Why v1 and not v2: v2 is the newer surface but is not at feature parity — it
 * has no company-scoped notes listing and no file download. v1 has exactly what
 * the data-room importer needs:
 *   GET /organizations?term=            — match a diligence deal to an Affinity org
 *   GET /notes?organization_id=         — the notes themselves
 *   GET /entity-files?organization_id=  — files people attached in Affinity
 *   GET /entity-files/{id}/download     — the bytes
 *
 * Auth: HTTP Basic with an empty username and the API key as the password.
 * Rate limits: 900 req/min per user. We fetch sequentially and honour 429s.
 */

const BASE = 'https://api.affinity.co'

export interface AffinityOrganization {
  id: number
  name: string
  domain: string | null
  domains?: string[]
}

export interface AffinityNote {
  id: number
  creator_id: number | null
  content: string
  /** 0 = plain text, 2 = HTML, 3 = AI notetaker (HTML). */
  type: number
  organization_ids: number[]
  person_ids: number[]
  opportunity_ids: number[]
  created_at: string
  updated_at: string | null
}

export interface AffinityEntityFile {
  id: number
  name: string
  size: number
  organization_id: number | null
  person_id: number | null
  opportunity_id: number | null
  uploader_id: number | null
  created_at: string
}

export interface AffinityWhoAmI {
  user: { id: number; firstName: string; lastName: string; emailAddress: string }
  tenant: { id: number; name: string; subdomain: string }
}

export class AffinityError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'AffinityError'
  }
}

export class AffinityClient {
  private readonly auth: string

  constructor(apiKey: string) {
    // Basic auth, empty username. Affinity documents the key as the password.
    this.auth = 'Basic ' + Buffer.from(`:${apiKey}`).toString('base64')
  }

  private async request<T>(path: string, opts: { raw?: boolean } = {}): Promise<T> {
    // One retry on 429. Affinity's per-minute budget (900/user) is generous
    // relative to a data-room import, so a single backoff is plenty; a longer
    // retry chain would just stall a user-facing stream.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${BASE}${path}`, {
        headers: {
          Authorization: this.auth,
          Accept: opts.raw ? '*/*' : 'application/json',
        },
      })

      if (res.status === 429 && attempt === 0) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '2')
        await new Promise(r => setTimeout(r, Math.min(retryAfter, 10) * 1000))
        continue
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new AffinityError(
          affinityErrorMessage(res.status, body),
          res.status
        )
      }

      return (opts.raw ? Buffer.from(await res.arrayBuffer()) : await res.json()) as T
    }
    throw new AffinityError('Affinity rate limit exceeded — try again shortly', 429)
  }

  /** Validate a key and identify who it belongs to. Used at connect time. */
  async whoami(): Promise<AffinityWhoAmI> {
    return this.request<AffinityWhoAmI>('/auth/whoami')
  }

  /** Search organizations by name or domain. Used to link a deal to an Affinity org. */
  async searchOrganizations(term: string): Promise<AffinityOrganization[]> {
    const res = await this.request<{ organizations: AffinityOrganization[] }>(
      `/organizations?term=${encodeURIComponent(term)}&page_size=20`
    )
    return res.organizations ?? []
  }

  async getOrganization(id: number): Promise<AffinityOrganization> {
    return this.request<AffinityOrganization>(`/organizations/${id}`)
  }

  /**
   * All notes attached to an organization (or opportunity), following pagination
   * to the end. A long-lived deal can accumulate hundreds of notes, so this is
   * capped — the cap is reported to the caller rather than silently truncating.
   */
  async listNotes(
    scope: { organizationId?: number; opportunityId?: number },
    maxNotes = 500
  ): Promise<{ notes: AffinityNote[]; truncated: boolean }> {
    const notes: AffinityNote[] = []
    let pageToken: string | null = null
    let truncated = false

    do {
      const params = new URLSearchParams({ page_size: '100' })
      if (scope.organizationId) params.set('organization_id', String(scope.organizationId))
      if (scope.opportunityId) params.set('opportunity_id', String(scope.opportunityId))
      if (pageToken) params.set('page_token', pageToken)

      const res: { notes?: AffinityNote[]; next_page_token?: string | null } =
        await this.request(`/notes?${params.toString()}`)

      notes.push(...(res.notes ?? []))
      pageToken = res.next_page_token ?? null

      if (notes.length >= maxNotes) {
        truncated = pageToken !== null
        break
      }
    } while (pageToken)

    return { notes: notes.slice(0, maxNotes), truncated }
  }

  /** Files people attached to the organization inside Affinity. */
  async listEntityFiles(
    scope: { organizationId?: number; opportunityId?: number }
  ): Promise<AffinityEntityFile[]> {
    const files: AffinityEntityFile[] = []
    let pageToken: string | null = null

    do {
      const params = new URLSearchParams({ page_size: '100' })
      if (scope.organizationId) params.set('organization_id', String(scope.organizationId))
      if (scope.opportunityId) params.set('opportunity_id', String(scope.opportunityId))
      if (pageToken) params.set('page_token', pageToken)

      const res: { entity_files?: AffinityEntityFile[]; next_page_token?: string | null } =
        await this.request(`/entity-files?${params.toString()}`)

      files.push(...(res.entity_files ?? []))
      pageToken = res.next_page_token ?? null
    } while (pageToken)

    return files
  }

  async downloadEntityFile(id: number): Promise<Buffer> {
    return this.request<Buffer>(`/entity-files/${id}/download`, { raw: true })
  }
}

function affinityErrorMessage(status: number, body: string): string {
  if (status === 401) return 'Affinity rejected the API key (401). Reconnect Affinity in Settings.'
  if (status === 403) return 'This Affinity key lacks permission for that resource (403).'
  if (status === 404) return 'Affinity record not found (404).'
  const detail = body.slice(0, 200)
  return `Affinity API error ${status}${detail ? `: ${detail}` : ''}`
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render an Affinity note as a Markdown document for the data room.
 *
 * The header matters as much as the body: the memo agent's ingest stage reads
 * these files as evidence and cites them, so the author and date have to travel
 * with the text. Without them a claim traces back to "an Affinity note" with no
 * way to tell a founder's own words from a partner's opinion.
 */
export function renderNoteAsMarkdown(
  note: AffinityNote,
  opts: { authorName?: string; organizationName?: string }
): string {
  const date = note.created_at ? new Date(note.created_at).toISOString().slice(0, 10) : 'unknown date'
  const author = opts.authorName || 'Unknown author'
  const kind = note.type === 3 ? 'AI notetaker transcript' : 'note'

  const body = note.type === 0 ? note.content : htmlToText(note.content)

  return [
    `# Affinity ${kind} — ${opts.organizationName ?? 'company'} — ${date}`,
    '',
    `- **Source:** Affinity (note #${note.id})`,
    `- **Author:** ${author}`,
    `- **Created:** ${note.created_at}`,
    '',
    '---',
    '',
    body.trim(),
    '',
  ].join('\n')
}

/**
 * Affinity note bodies are HTML for everything except plain-text notes. We only
 * need readable text for the LLM, so strip tags rather than pulling in a parser
 * — but convert block-level tags to newlines first, otherwise paragraphs and
 * list items run together into one unreadable line.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
