import yaml from 'js-yaml'
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Schema registry
// ---------------------------------------------------------------------------

export const SCHEMA_NAMES = [
  'rubric',
  'qa_library',
  'data_room_ingestion',
  'research_dossier',
  'memo_output',
  'style_anchors',
  'instructions',
] as const

export type SchemaName = typeof SCHEMA_NAMES[number]

/** Markdown schemas don't validate against a JSON Schema — they are arbitrary text. */
const MARKDOWN_SCHEMAS: SchemaName[] = ['instructions']

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface ValidationError {
  /** Human-readable message ready to display in the editor sidebar. */
  message: string
  /** Best-effort source line (1-indexed). Undefined when we can't map. */
  line?: number
  /** JSON path inside the parsed object, e.g. "/dimensions/0/id". Undefined for syntax errors. */
  path?: string
  /** Originating error category. */
  kind: 'syntax' | 'schema'
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  /** Parsed YAML (or raw markdown text) when parsing succeeded; undefined on syntax error. */
  parsed: unknown
}

// ---------------------------------------------------------------------------
// Compiled validator cache
// ---------------------------------------------------------------------------

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true })
addFormats(ajv)

const compiledValidators = new Map<SchemaName, ValidateFunction>()

async function getValidator(name: SchemaName): Promise<ValidateFunction | null> {
  if (MARKDOWN_SCHEMAS.includes(name)) return null
  const cached = compiledValidators.get(name)
  if (cached) return cached

  const schemaPath = path.join(process.cwd(), 'lib/memo-agent/schemas', `${name}.schema.json`)
  const schemaJson = JSON.parse(await fs.readFile(schemaPath, 'utf8'))
  const validate = ajv.compile(schemaJson)
  compiledValidators.set(name, validate)
  return validate
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse + validate a schema file's content. Always returns a ValidationResult;
 * never throws on bad input.
 *
 * For YAML schemas this is a two-step pipeline:
 *   1. js-yaml parse → if it throws, return one syntax error with line number.
 *   2. ajv validate against the corresponding JSON Schema → return zero or more schema errors.
 *
 * For markdown schemas (instructions) there is no JSON Schema, so we only check
 * that the content isn't empty and return parsed: { content }.
 */
export async function validateSchema(name: SchemaName, content: string): Promise<ValidationResult> {
  if (!SCHEMA_NAMES.includes(name)) {
    return {
      valid: false,
      parsed: undefined,
      errors: [{ message: `Unknown schema: ${name}`, kind: 'schema' }],
    }
  }

  if (MARKDOWN_SCHEMAS.includes(name)) {
    const trimmed = content.trim()
    if (!trimmed) {
      return {
        valid: false,
        parsed: undefined,
        errors: [{ message: 'Instructions cannot be empty.', kind: 'schema' }],
      }
    }
    return { valid: true, parsed: { content }, errors: [] }
  }

  // Step 1: YAML parse.
  let parsed: unknown
  try {
    parsed = yaml.load(content)
  } catch (err) {
    if (err instanceof yaml.YAMLException) {
      const line = err.mark?.line !== undefined ? err.mark.line + 1 : undefined
      return {
        valid: false,
        parsed: undefined,
        errors: [{
          message: err.reason || err.message,
          line,
          kind: 'syntax',
        }],
      }
    }
    return {
      valid: false,
      parsed: undefined,
      errors: [{ message: err instanceof Error ? err.message : String(err), kind: 'syntax' }],
    }
  }

  // Step 2: schema validation.
  const validator = await getValidator(name)
  if (!validator) {
    // Should never happen for non-markdown schemas, but handle gracefully.
    return { valid: true, parsed, errors: [] }
  }

  const valid = validator(parsed)
  if (valid) return { valid: true, parsed, errors: [] }

  const errors = (validator.errors ?? []).map(formatAjvError)
  return { valid: false, parsed, errors }
}

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

function formatAjvError(err: ErrorObject): ValidationError {
  const path = err.instancePath || '/'
  const where = path === '/' ? 'document root' : path

  let message: string
  switch (err.keyword) {
    case 'required':
      message = `${where}: missing required property "${(err.params as any).missingProperty}"`
      break
    case 'enum':
      message = `${where}: value must be one of ${JSON.stringify((err.params as any).allowedValues)}`
      break
    case 'type':
      message = `${where}: expected ${(err.params as any).type}, got ${typeof err.data}`
      break
    case 'additionalProperties':
      message = `${where}: unexpected property "${(err.params as any).additionalProperty}"`
      break
    case 'pattern':
      message = `${where}: value does not match pattern ${(err.params as any).pattern}`
      break
    default:
      message = `${where}: ${err.message ?? err.keyword}`
  }

  return { message, path, kind: 'schema' }
}
