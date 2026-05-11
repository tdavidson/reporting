import { createAdminClient } from '@/lib/supabase/admin'
import yaml from 'js-yaml'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { validateSchema, type SchemaName, type ValidationError, SCHEMA_NAMES } from './validate'

type Admin = ReturnType<typeof createAdminClient>

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActiveSchema {
  id: string
  fund_id: string
  schema_name: SchemaName
  schema_version: string
  yaml_content: string
  parsed_content: unknown
  is_active: boolean
  edit_note: string | null
  edited_by: string | null
  edited_at: string
  created_at: string
}

export interface SaveResult {
  ok: boolean
  /** When ok=false, validation errors prevented the save. */
  errors: ValidationError[]
  /** When ok=true, warnings about cross-schema references that may now be broken. */
  warnings: CrossReferenceWarning[]
  /** When ok=true, the newly-saved schema row. */
  schema?: ActiveSchema
}

export interface CrossReferenceWarning {
  /** Which schema's references are now potentially broken. */
  source_schema: SchemaName
  /** The reference field in the source schema. */
  field: string
  /** The id that's no longer valid in the target schema. */
  missing_id: string
  message: string
}

// ---------------------------------------------------------------------------
// Cache (5-minute TTL)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { value: ActiveSchema | null; expiresAt: number }>()

function cacheKey(fundId: string, name: SchemaName): string {
  return `${fundId}:${name}`
}

function cacheGet(fundId: string, name: SchemaName): ActiveSchema | null | undefined {
  const entry = cache.get(cacheKey(fundId, name))
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    cache.delete(cacheKey(fundId, name))
    return undefined
  }
  return entry.value
}

function cacheSet(fundId: string, name: SchemaName, value: ActiveSchema | null): void {
  cache.set(cacheKey(fundId, name), { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

function cacheInvalidate(fundId: string, name?: SchemaName): void {
  if (name) {
    cache.delete(cacheKey(fundId, name))
  } else {
    for (const key of Array.from(cache.keys())) {
      if (key.startsWith(`${fundId}:`)) cache.delete(key)
    }
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getActiveSchema(fundId: string, name: SchemaName, admin?: Admin): Promise<ActiveSchema | null> {
  const cached = cacheGet(fundId, name)
  if (cached !== undefined) return cached

  const client = admin ?? createAdminClient()
  const { data, error } = await client
    .from('firm_schemas')
    .select('id, fund_id, schema_name, schema_version, yaml_content, parsed_content, is_active, edit_note, edited_by, edited_at, created_at')
    .eq('fund_id', fundId)
    .eq('schema_name', name)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    console.error('[firm-schemas] getActiveSchema error:', error)
    return null
  }

  const row = (data as ActiveSchema | null) ?? null
  cacheSet(fundId, name, row)
  return row
}

export async function getActiveSchemas(fundId: string, admin?: Admin): Promise<Record<SchemaName, ActiveSchema | null>> {
  const client = admin ?? createAdminClient()
  const { data, error } = await client
    .from('firm_schemas')
    .select('id, fund_id, schema_name, schema_version, yaml_content, parsed_content, is_active, edit_note, edited_by, edited_at, created_at')
    .eq('fund_id', fundId)
    .eq('is_active', true)

  if (error) {
    console.error('[firm-schemas] getActiveSchemas error:', error)
    return Object.fromEntries(SCHEMA_NAMES.map(n => [n, null])) as Record<SchemaName, ActiveSchema | null>
  }

  const rows = (data ?? []) as ActiveSchema[]
  const result = Object.fromEntries(SCHEMA_NAMES.map(n => [n, null])) as Record<SchemaName, ActiveSchema | null>
  for (const row of rows) {
    result[row.schema_name] = row
    cacheSet(fundId, row.schema_name, row)
  }
  return result
}

/**
 * Insert default v0.1 rows for any of the seven schemas that don't yet exist
 * for this fund. Reads YAML/MD content from `lib/memo-agent/defaults/`.
 *
 * Called by the schema editor API on each load — first call per fund seeds;
 * subsequent calls no-op. This avoids ballooning the migration with embedded
 * YAML and handles funds created after the migration ran.
 */
export async function ensureDefaults(fundId: string, admin?: Admin): Promise<void> {
  const client = admin ?? createAdminClient()
  const existing = await getActiveSchemas(fundId, client)
  const missing = SCHEMA_NAMES.filter(n => !existing[n])
  if (missing.length === 0) return

  for (const name of missing) {
    const content = await loadDefaultContent(name)
    if (content === null) {
      console.warn(`[firm-schemas] default content for ${name} not found on disk; skipping seed`)
      continue
    }
    let parsed: unknown = null
    if (name !== 'instructions') {
      try {
        parsed = yaml.load(content)
      } catch {
        // Defaults should always parse; if not, leave parsed_content null.
      }
    }
    await client.from('firm_schemas').insert({
      fund_id: fundId,
      schema_name: name,
      schema_version: 'v0.1',
      yaml_content: content,
      parsed_content: parsed as any,
      is_active: true,
      edit_note: 'Initial defaults from lib/memo-agent/defaults',
      edited_by: null,
    })
  }

  // Bust the cache so the next read picks up the freshly-inserted rows.
  cacheInvalidate(fundId)
}

async function loadDefaultContent(name: SchemaName): Promise<string | null> {
  const filename = name === 'instructions' ? 'instructions.md' : `${name}.yaml`
  const filePath = path.join(process.cwd(), 'lib/memo-agent/defaults', filename)
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

export async function getSchemaHistory(fundId: string, name: SchemaName, admin?: Admin): Promise<ActiveSchema[]> {
  const client = admin ?? createAdminClient()
  const { data, error } = await client
    .from('firm_schemas')
    .select('id, fund_id, schema_name, schema_version, yaml_content, parsed_content, is_active, edit_note, edited_by, edited_at, created_at')
    .eq('fund_id', fundId)
    .eq('schema_name', name)
    .order('edited_at', { ascending: false })

  if (error) {
    console.error('[firm-schemas] getSchemaHistory error:', error)
    return []
  }
  return (data ?? []) as ActiveSchema[]
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface SaveOptions {
  /** When true, save proceeds even if cross-reference warnings would be raised. */
  acceptWarnings?: boolean
}

/**
 * Validate yamlContent against the schema name's JSON Schema. If valid, deactivate
 * the prior active version and insert a new active row. Optionally surfaces
 * cross-reference warnings (broken rubric ↔ qa_library references).
 *
 * Returns:
 *   ok=false + errors      → validation failed; nothing written.
 *   ok=true + warnings.length>0 + !acceptWarnings → save blocked pending confirmation.
 *   ok=true + schema       → saved successfully; cache invalidated.
 */
export async function saveSchema(
  fundId: string,
  name: SchemaName,
  yamlContent: string,
  editorId: string,
  editNote: string | null,
  options: SaveOptions = {},
  admin?: Admin,
): Promise<SaveResult> {
  const client = admin ?? createAdminClient()

  // 1. Validate.
  const validation = await validateSchema(name, yamlContent)
  if (!validation.valid) {
    return { ok: false, errors: validation.errors, warnings: [] }
  }

  // 2. Cross-reference check (only when saving rubric or qa_library).
  let warnings: CrossReferenceWarning[] = []
  if (name === 'rubric' || name === 'qa_library') {
    warnings = await crossReferenceCheck(client, fundId, name, validation.parsed)
    if (warnings.length > 0 && !options.acceptWarnings) {
      return { ok: false, errors: [], warnings }
    }
  }

  // 3. Compute next version label.
  const current = await getActiveSchema(fundId, name, client)
  const nextVersion = bumpVersion(current?.schema_version ?? 'v0.0')

  // 4. Deactivate prior active row, insert new active row.
  if (current) {
    await client.from('firm_schemas').update({ is_active: false }).eq('id', current.id)
  }

  const { data: inserted, error: insertErr } = await client
    .from('firm_schemas')
    .insert({
      fund_id: fundId,
      schema_name: name,
      schema_version: nextVersion,
      yaml_content: yamlContent,
      parsed_content: name === 'instructions' ? null : (validation.parsed as any),
      is_active: true,
      edit_note: editNote,
      edited_by: editorId,
    })
    .select('id, fund_id, schema_name, schema_version, yaml_content, parsed_content, is_active, edit_note, edited_by, edited_at, created_at')
    .single()

  if (insertErr || !inserted) {
    // Re-activate the previous row if we deactivated it.
    if (current) {
      await client.from('firm_schemas').update({ is_active: true }).eq('id', current.id)
    }
    return {
      ok: false,
      errors: [{ message: insertErr?.message ?? 'Save failed.', kind: 'schema' }],
      warnings,
    }
  }

  cacheInvalidate(fundId, name)
  return { ok: true, errors: [], warnings, schema: inserted as ActiveSchema }
}

/**
 * Restore a prior version by re-activating it (creating a fresh row that
 * mirrors the historical content; preserves the audit log of who/when).
 */
export async function rollbackSchema(
  fundId: string,
  name: SchemaName,
  targetVersionId: string,
  editorId: string,
  admin?: Admin,
): Promise<SaveResult> {
  const client = admin ?? createAdminClient()

  // Fetch the target version.
  const { data: target, error: targetErr } = await client
    .from('firm_schemas')
    .select('schema_name, fund_id, yaml_content, schema_version')
    .eq('id', targetVersionId)
    .eq('fund_id', fundId)
    .eq('schema_name', name)
    .maybeSingle()

  if (targetErr || !target) {
    return {
      ok: false,
      errors: [{ message: 'Target version not found.', kind: 'schema' }],
      warnings: [],
    }
  }

  // Save its content as a new active version. Carry over a rollback note.
  const note = `Rollback to ${(target as any).schema_version}`
  return saveSchema(
    fundId,
    name,
    (target as any).yaml_content,
    editorId,
    note,
    { acceptWarnings: true }, // rollbacks accept any warnings the prior version had
    client,
  )
}

// ---------------------------------------------------------------------------
// Cross-reference check
// ---------------------------------------------------------------------------

/**
 * When saving rubric or qa_library, check whether the dimension IDs referenced
 * in qa_library entries' `feeds_dimensions` still exist in the rubric. If a
 * reference would break, surface a warning so the editor can ask the partner
 * to confirm before proceeding.
 */
async function crossReferenceCheck(
  client: Admin,
  fundId: string,
  savingSchema: 'rubric' | 'qa_library',
  parsedNew: unknown,
): Promise<CrossReferenceWarning[]> {
  const warnings: CrossReferenceWarning[] = []

  // Resolve the active rubric (either the just-parsed new version or the stored one).
  const rubricParsed: unknown = savingSchema === 'rubric'
    ? parsedNew
    : await loadParsed(client, fundId, 'rubric')

  // Resolve the active qa_library similarly.
  const qaParsed: unknown = savingSchema === 'qa_library'
    ? parsedNew
    : await loadParsed(client, fundId, 'qa_library')

  if (!rubricParsed || !qaParsed) return warnings

  const rubricDimensionIds = extractRubricDimensionIds(rubricParsed)
  const qaReferences = extractQaFeedsDimensions(qaParsed)

  for (const ref of qaReferences) {
    if (!rubricDimensionIds.has(ref.id)) {
      warnings.push({
        source_schema: 'qa_library',
        field: ref.field,
        missing_id: ref.id,
        message: `Question "${ref.qid}" references rubric dimension "${ref.id}" which does not exist.`,
      })
    }
  }

  return warnings
}

async function loadParsed(client: Admin, fundId: string, name: SchemaName): Promise<unknown | null> {
  const row = await getActiveSchema(fundId, name, client)
  if (!row) return null
  if (row.parsed_content) return row.parsed_content
  // Fall back to re-parsing the yaml.
  try {
    return yaml.load(row.yaml_content)
  } catch {
    return null
  }
}

function extractRubricDimensionIds(parsed: unknown): Set<string> {
  const ids = new Set<string>()
  if (!parsed || typeof parsed !== 'object') return ids
  const dims = (parsed as any).dimensions
  if (!Array.isArray(dims)) return ids
  for (const d of dims) {
    if (d && typeof d.id === 'string') ids.add(d.id)
  }
  return ids
}

function extractQaFeedsDimensions(parsed: unknown): Array<{ qid: string; id: string; field: string }> {
  const refs: Array<{ qid: string; id: string; field: string }> = []
  if (!parsed || typeof parsed !== 'object') return refs
  const questions = (parsed as any).questions
  if (!Array.isArray(questions)) return refs
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue
    const qid = typeof q.id === 'string' ? q.id : '(unknown)'
    const feeds = q.feeds_dimensions
    if (Array.isArray(feeds)) {
      for (const dimId of feeds) {
        if (typeof dimId === 'string') {
          refs.push({ qid, id: dimId, field: 'questions[].feeds_dimensions' })
        }
      }
    }
  }
  return refs
}

// ---------------------------------------------------------------------------
// Versioning helpers
// ---------------------------------------------------------------------------

function bumpVersion(current: string): string {
  // Versions look like "v0.1", "v0.2-post-qa", "v1.3". We bump the minor
  // component and drop any suffix.
  const m = current.match(/^v(\d+)\.(\d+)/)
  if (!m) return 'v0.1'
  const major = parseInt(m[1], 10)
  const minor = parseInt(m[2], 10) + 1
  return `v${major}.${minor}`
}
