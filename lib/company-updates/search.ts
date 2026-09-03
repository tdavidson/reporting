/**
 * Retrieval service over the Company Updates corpus. One boundary for the timeline API, the
 * portfolio search page, and the Analyst `get_updates` tool, so they cannot disagree about
 * filtering, counting, ordering or fund scoping.
 *
 * Every function takes the fund id the CALLER resolved from membership and passes it into SQL.
 * The RPCs are service-role only; nothing here widens what the caller could already see.
 */

export interface SearchParams {
  fundId: string
  query?: string | null
  companyIds?: string[] | null
  /** ISO date (YYYY-MM-DD), inclusive. */
  since?: string | null
  /** ISO date (YYYY-MM-DD), inclusive — implemented in SQL as < the following day. */
  until?: string | null
  latestPerCompany?: boolean
  order?: 'relevance' | 'newest' | null
  match?: 'auto' | 'lexical' | 'exact'
  limit?: number
  /** Opaque cursor from a previous response. */
  cursor?: string | null
  excerpts?: number
}

export interface SearchExcerpt {
  chunk_id: string
  artifact_id: string | null
  filename: string | null
  chunk_kind: 'subject' | 'artifact_title' | 'body_original' | 'body_current' | 'attachment'
  ordinal: number
  locator: Record<string, unknown>
  text: string
}

export interface SearchResult {
  update_id: string
  company_id: string
  company_name: string
  source_email_id: string
  received_at: string
  subject: string | null
  sender_name: string | null
  sender_email: string | null
  forwarded_sender_name: string | null
  forwarded_sender_email: string | null
  period_label: string | null
  period_source: string | null
  extraction_status: 'complete' | 'partial' | 'failed'
  warnings: string[]
  rank: number
  excerpts: SearchExcerpt[]
  artifacts: Array<{ id: string; ordinal: number; filename: string; extraction_status: string; ocr_status: string }>
}

export interface SearchResponse {
  total: number
  results: SearchResult[]
  next_cursor: string | null
  match_mode: 'none' | 'lexical' | 'exact'
  order: 'relevance' | 'newest'
  /** Set when an auto-mode lexical search found nothing and the exact-substring pass ran instead. */
  fallback?: 'exact'
}

type Admin = { from: (table: any) => any; rpc: (...args: any[]) => any }

export const MAX_SEARCH_LIMIT = 100
export const DEFAULT_SEARCH_LIMIT = 20
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class SearchParamsError extends Error {}

/** Validate untrusted input (query string or tool call) into SearchParams; throws SearchParamsError. */
export function parseSearchParams(fundId: string, input: Record<string, unknown>): SearchParams {
  const str = (key: string) => {
    const value = input[key]
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string') throw new SearchParamsError(`${key} must be a string`)
    return value
  }
  const date = (key: string) => {
    const value = str(key)
    if (value === null) return null
    if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) throw new SearchParamsError(`${key} must be an ISO date (YYYY-MM-DD)`)
    return value
  }
  const since = date('since')
  const until = date('until')
  if (since && until && since > until) throw new SearchParamsError('since must not be after until')

  let companyIds: string[] | null = null
  const rawCompanies = input.company_ids ?? input.companyIds ?? input.company_id ?? input.companyId
  if (rawCompanies !== undefined && rawCompanies !== null && rawCompanies !== '') {
    const list = Array.isArray(rawCompanies) ? rawCompanies : String(rawCompanies).split(',')
    companyIds = list.map(id => String(id).trim()).filter(Boolean)
    if (companyIds.length === 0) companyIds = null
    else if (companyIds.length > 200) throw new SearchParamsError('at most 200 company ids')
    else if (!companyIds.every(id => UUID.test(id))) throw new SearchParamsError('company ids must be UUIDs')
  }

  const order = str('order')
  if (order && order !== 'relevance' && order !== 'newest') throw new SearchParamsError('order must be relevance or newest')
  const match = str('match') ?? 'auto'
  if (match !== 'auto' && match !== 'lexical' && match !== 'exact') throw new SearchParamsError('match must be auto, lexical or exact')

  const limitRaw = input.limit
  let limit = DEFAULT_SEARCH_LIMIT
  if (limitRaw !== undefined && limitRaw !== null && limitRaw !== '') {
    limit = Number(limitRaw)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
      throw new SearchParamsError(`limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}`)
    }
  }
  const excerptsRaw = input.excerpts
  let excerpts = 3
  if (excerptsRaw !== undefined && excerptsRaw !== null && excerptsRaw !== '') {
    excerpts = Number(excerptsRaw)
    if (!Number.isInteger(excerpts) || excerpts < 0 || excerpts > 10) throw new SearchParamsError('excerpts must be between 0 and 10')
  }

  const latestRaw = input.latest_per_company ?? input.latestPerCompany
  const latestPerCompany = latestRaw === true || latestRaw === 'true' || latestRaw === '1'

  const query = str('query') ?? str('q')
  if (query && query.length > 500) throw new SearchParamsError('query must be at most 500 characters')

  return {
    fundId,
    query,
    companyIds,
    since,
    until,
    latestPerCompany,
    order: (order as 'relevance' | 'newest' | null) ?? null,
    match: match as 'auto' | 'lexical' | 'exact',
    limit,
    cursor: str('cursor'),
    excerpts,
  }
}

export function encodeCursor(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) return null
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string | null | undefined): Record<string, unknown> | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch {
    throw new SearchParamsError('cursor is malformed')
  }
}

/** Fund-scoped search/list over the corpus; counts, ranking and pagination happen in SQL. */
export async function searchCompanyUpdates(admin: Admin, params: SearchParams): Promise<SearchResponse> {
  const { data, error } = await admin.rpc('company_updates_search', {
    p_fund_id: params.fundId,
    p_query: params.query ?? null,
    p_company_ids: params.companyIds ?? null,
    p_since: params.since ?? null,
    p_until: params.until ?? null,
    p_latest_per_company: params.latestPerCompany ?? false,
    p_order: params.order ?? null,
    p_match: params.match ?? 'auto',
    p_limit: params.limit ?? DEFAULT_SEARCH_LIMIT,
    p_cursor: decodeCursor(params.cursor),
    p_excerpts: params.excerpts ?? 3,
  })
  if (error) {
    // 22023 = invalid_parameter_value raised by the function's own validation: a caller error.
    if (error.code === '22023' || /must be|is required|malformed|no searchable terms/i.test(error.message ?? '')) {
      throw new SearchParamsError(error.message)
    }
    throw new Error(`Company Updates search failed: ${error.message}`)
  }
  const raw = data as any
  return {
    total: Number(raw?.total ?? 0),
    results: (raw?.results ?? []) as SearchResult[],
    next_cursor: encodeCursor(raw?.next_cursor ?? null),
    match_mode: raw?.match_mode ?? 'none',
    order: raw?.order ?? 'newest',
    ...(raw?.fallback ? { fallback: raw.fallback } : {}),
  }
}

// ─── Timeline ─────────────────────────────────────────────────────────────────────────────────

export interface TimelineArtifact {
  id: string
  ordinal: number
  filename: string
  declared_content_type: string | null
  detected_content_type: string | null
  byte_size: number | null
  extraction_status: 'complete' | 'partial' | 'failed' | 'not_applicable'
  parser: string | null
  parser_version: string | null
  warnings: string[]
  extraction_error: string | null
  metadata: Record<string, unknown>
  ocr_status: string
  ocr_error: string | null
  has_text: boolean
  has_source_file: boolean
}

export interface TimelineUpdate {
  id: string
  company_id: string
  source_email_id: string
  received_at: string
  subject: string | null
  sender_name: string | null
  sender_email: string | null
  forwarded_sender_name: string | null
  forwarded_sender_email: string | null
  period_label: string | null
  period_source: string | null
  body_preview: string
  body_cleaning_status: string
  extraction_status: 'complete' | 'partial' | 'failed'
  warnings: string[]
  parser_version: string | null
  updated_at: string
  artifacts: TimelineArtifact[]
}

export const BODY_PREVIEW_CHARS = 280
const ARTIFACT_META_COLUMNS =
  'id, update_id, ordinal, filename, declared_content_type, detected_content_type, byte_size, storage_path, ' +
  'extraction_status, parser, parser_version, warnings, extraction_error, metadata, ocr_status, ocr_error, extracted_text'
const UPDATE_LIST_COLUMNS =
  'id, company_id, source_email_id, received_at, subject, sender_name, sender_email, forwarded_sender_name, ' +
  'forwarded_sender_email, period_label, period_source, body_current, body_original, body_cleaning_status, ' +
  'extraction_status, warnings, parser_version, updated_at'

/** Reverse-chronological, cursor-paginated updates for one company. Previews only; no full text. */
export async function listCompanyUpdates(
  admin: Admin,
  params: { fundId: string; companyId: string; cursor?: string | null; limit?: number },
): Promise<{ updates: TimelineUpdate[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50)
  const cursor = decodeCursor(params.cursor)
  let query = admin
    .from('company_updates')
    .select(UPDATE_LIST_COLUMNS)
    .eq('fund_id', params.fundId)
    .eq('company_id', params.companyId)
    .order('received_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (cursor) {
    const received = String(cursor.received_at ?? '')
    const id = String(cursor.id ?? '')
    if (!received || !UUID.test(id)) throw new SearchParamsError('cursor is malformed')
    query = query.or(`received_at.lt.${received},and(received_at.eq.${received},id.lt.${id})`)
  }
  const { data, error } = await query
  if (error) throw new Error(`Could not list Company Updates: ${error.message}`)
  const rows = (data ?? []) as any[]
  const page = rows.slice(0, limit)
  const artifactsByUpdate = await artifactsFor(admin, params.fundId, page.map(row => row.id))

  const updates: TimelineUpdate[] = page.map(row => toTimelineUpdate(row, artifactsByUpdate.get(row.id) ?? []))
  const last = page[page.length - 1]
  return {
    updates,
    next_cursor: rows.length > limit && last ? encodeCursor({ received_at: last.received_at, id: last.id }) : null,
  }
}

/** One update in full: both body representations plus artifact metadata (still no artifact text). */
export async function getCompanyUpdate(
  admin: Admin,
  params: { fundId: string; updateId: string },
): Promise<(TimelineUpdate & { body_original: string | null; body_current: string | null; body_status: string; company_name: string | null }) | null> {
  const { data, error } = await admin
    .from('company_updates')
    .select(`${UPDATE_LIST_COLUMNS}, body_status, companies(name)`)
    .eq('fund_id', params.fundId)
    .eq('id', params.updateId)
    .maybeSingle()
  if (error) throw new Error(`Could not load Company Update: ${error.message}`)
  if (!data) return null
  const row = data as any
  const artifacts = (await artifactsFor(admin, params.fundId, [row.id])).get(row.id) ?? []
  return {
    ...toTimelineUpdate(row, artifacts),
    body_original: row.body_original ?? null,
    body_current: row.body_current ?? null,
    body_status: row.body_status,
    company_name: row.companies?.name ?? null,
  }
}

/** One artifact's complete extracted text, plus the chunk locators that index it. */
export async function getCompanyUpdateArtifact(
  admin: Admin,
  params: { fundId: string; artifactId: string },
): Promise<(TimelineArtifact & { update_id: string; storage_path: string | null; extracted_text: string; chunks: Array<{ ordinal: number; locator: Record<string, unknown>; chars: number }> }) | null> {
  const { data, error } = await admin
    .from('company_update_artifacts')
    .select(ARTIFACT_META_COLUMNS)
    .eq('fund_id', params.fundId)
    .eq('id', params.artifactId)
    .maybeSingle()
  if (error) throw new Error(`Could not load Company Update artifact: ${error.message}`)
  if (!data) return null
  const row = data as any
  const { data: chunkRows, error: chunkError } = await admin
    .from('company_update_chunks')
    .select('ordinal, locator, content')
    .eq('fund_id', params.fundId)
    .eq('artifact_id', params.artifactId)
    .eq('chunk_kind', 'attachment')
    .order('ordinal', { ascending: true })
  if (chunkError) throw new Error(`Could not load Company Update chunks: ${chunkError.message}`)
  return {
    ...toTimelineArtifact(row),
    update_id: row.update_id,
    storage_path: row.storage_path ?? null,
    extracted_text: row.extracted_text ?? '',
    chunks: ((chunkRows ?? []) as any[]).map(chunk => ({ ordinal: chunk.ordinal, locator: chunk.locator ?? {}, chars: String(chunk.content ?? '').length })),
  }
}

async function artifactsFor(admin: Admin, fundId: string, updateIds: string[]): Promise<Map<string, TimelineArtifact[]>> {
  const map = new Map<string, TimelineArtifact[]>()
  if (updateIds.length === 0) return map
  // extracted_text is deliberately NOT selected; `has_text` is derived from a cheap length check.
  const { data, error } = await admin
    .from('company_update_artifacts')
    .select(ARTIFACT_META_COLUMNS.replace(', extracted_text', ''))
    .eq('fund_id', fundId)
    .in('update_id', updateIds)
    .order('ordinal', { ascending: true })
  if (error) throw new Error(`Could not load Company Update artifacts: ${error.message}`)
  for (const row of (data ?? []) as any[]) {
    const list = map.get(row.update_id) ?? []
    list.push(toTimelineArtifact(row))
    map.set(row.update_id, list)
  }
  return map
}

function toTimelineUpdate(row: any, artifacts: TimelineArtifact[]): TimelineUpdate {
  const body: string = row.body_current || row.body_original || ''
  return {
    id: row.id,
    company_id: row.company_id,
    source_email_id: row.source_email_id,
    received_at: row.received_at,
    subject: row.subject ?? null,
    sender_name: row.sender_name ?? null,
    sender_email: row.sender_email ?? null,
    forwarded_sender_name: row.forwarded_sender_name ?? null,
    forwarded_sender_email: row.forwarded_sender_email ?? null,
    period_label: row.period_label ?? null,
    period_source: row.period_source ?? null,
    body_preview: preview(body),
    body_cleaning_status: row.body_cleaning_status,
    extraction_status: row.extraction_status,
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    parser_version: row.parser_version ?? null,
    updated_at: row.updated_at,
    artifacts,
  }
}

function toTimelineArtifact(row: any): TimelineArtifact {
  return {
    id: row.id,
    ordinal: row.ordinal,
    filename: row.filename,
    declared_content_type: row.declared_content_type ?? null,
    detected_content_type: row.detected_content_type ?? null,
    byte_size: row.byte_size ?? null,
    extraction_status: row.extraction_status,
    parser: row.parser ?? null,
    parser_version: row.parser_version ?? null,
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    extraction_error: row.extraction_error ?? null,
    metadata: row.metadata ?? {},
    ocr_status: row.ocr_status ?? 'not_needed',
    ocr_error: row.ocr_error ?? null,
    has_text: row.extracted_text !== undefined ? Boolean(row.extracted_text) : row.extraction_status === 'complete' || row.extraction_status === 'partial',
    has_source_file: Boolean(row.storage_path),
  }
}

export function preview(text: string, chars = BODY_PREVIEW_CHARS): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= chars) return collapsed
  const cut = collapsed.lastIndexOf(' ', chars)
  return `${collapsed.slice(0, cut > chars * 0.6 ? cut : chars)}…`
}
