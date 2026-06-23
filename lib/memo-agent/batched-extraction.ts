import { extractJsonObject, recoverArrayItems } from '@/lib/memo-agent/parse-ai-json'

/**
 * Shared "decompose + tolerate" runner for memo-agent stages that ask the model
 * to return a JSON array of per-unit results (rubric scores, checklist
 * assessments, …).
 *
 * The failure mode it fixes is OUTPUT-token truncation: when one call has to
 * emit a result for every unit at once, a long rubric/checklist overruns the
 * model's max_tokens budget and the JSON is cut off mid-array, so the whole
 * response fails to parse and the stage errors. Raising max_tokens only delays
 * the wall — the real fix (already used by the draft stage) is to:
 *
 *   1. split the units into batches small enough that each call's output stays
 *      well under the cap;
 *   2. run the batches in parallel, each in its own try/catch, so one bad batch
 *      degrades to a warning instead of failing the whole stage;
 *   3. parse each batch tolerantly — primary parse via {@link extractJsonObject},
 *      and on failure (almost always a mid-array truncation) salvage every
 *      element the model finished via {@link recoverArrayItems}.
 *
 * The caller owns the prompt and the model call (so per-stage context, system
 * prompt, and usage logging stay where they belong); this runner owns the
 * batching, parallelism, parse/salvage, and warning collection.
 */

export interface BatchedAIResponse {
  text: string
  truncated?: boolean
}

export interface BatchedExtractionOptions<Unit, Row> {
  /** The units to process (e.g. rubric dimensions, checklist items). */
  units: Unit[]
  /** Max units handed to a single model call — keeps each call's output bounded. */
  batchSize: number
  /** Top-level JSON array key the model returns, e.g. 'scores' or 'items'. */
  arrayKey: string
  /** Run the model for one batch and return its raw response. Throwing here is fine — it degrades to a batch error. */
  call: (batch: Unit[], index: number) => Promise<BatchedAIResponse>
  /** Normalize one raw array element into a Row, or null to drop it. */
  coerce: (raw: unknown) => Row | null
  /** Optional progress label for a batch. */
  label?: (batch: Unit[], index: number, total: number) => string
  /** Optional progress callback. */
  note?: (msg: string) => Promise<void>
}

export interface BatchedExtractionResult<Row> {
  /** All rows recovered across every batch, in batch order. */
  rows: Row[]
  /** Non-fatal issues (partial truncation salvage, malformed-but-recovered). */
  warnings: string[]
  /** Fatal-per-batch failures (call threw, or nothing recoverable). */
  batchErrors: string[]
  /** Number of batches the units were split into. */
  batchCount: number
}

export async function runBatchedExtraction<Unit, Row>(
  opts: BatchedExtractionOptions<Unit, Row>,
): Promise<BatchedExtractionResult<Row>> {
  const { units, batchSize, arrayKey, call, coerce } = opts

  const batches: Unit[][] = []
  for (let i = 0; i < units.length; i += Math.max(1, batchSize)) {
    batches.push(units.slice(i, i + Math.max(1, batchSize)))
  }

  const warnings: string[] = []
  const batchErrors: string[] = []
  let done = 0

  const lists = await Promise.all(batches.map(async (batch, idx): Promise<Row[]> => {
    const label = opts.label ? opts.label(batch, idx, batches.length) : `batch ${idx + 1}/${batches.length}`

    let res: BatchedAIResponse
    try {
      res = await call(batch, idx)
    } catch (err) {
      batchErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`)
      done += 1
      if (opts.note) await opts.note(`Batch ${done}/${batches.length} failed: ${label}`)
      return []
    }

    const truncated = !!res.truncated

    // Primary parse: the whole response is valid JSON.
    let rows: Row[] = []
    try {
      const obj = extractJsonObject(res.text)
      const arr = obj && typeof obj === 'object' && Array.isArray((obj as Record<string, unknown>)[arrayKey])
        ? ((obj as Record<string, unknown>)[arrayKey] as unknown[])
        : []
      rows = arr.map(coerce).filter((r): r is Row => r !== null)
    } catch {
      rows = []
    }

    // Salvage: a mid-array truncation makes the document unparseable as a whole,
    // but every element finished before the cut is still valid JSON.
    if (rows.length === 0) {
      const recovered = recoverArrayItems(res.text, arrayKey)
        .map(coerce)
        .filter((r): r is Row => r !== null)
      if (recovered.length > 0) {
        rows = recovered
        warnings.push(
          truncated
            ? `${label} hit the output-token limit; recovered ${recovered.length} item(s) completed before the cut and left the rest.`
            : `${label} response was partially malformed; recovered ${recovered.length} item(s) and skipped the rest.`,
        )
      } else {
        batchErrors.push(
          truncated
            ? `${label}: truncated at the output-token limit before any item could be recovered`
            : `${label}: unparseable response`,
        )
      }
    } else if (truncated) {
      // Some rows parsed but the array itself was cut — recover any extras.
      const recovered = recoverArrayItems(res.text, arrayKey)
        .map(coerce)
        .filter((r): r is Row => r !== null)
      if (recovered.length > rows.length) rows = recovered
      warnings.push(`${label} hit the output-token limit; recovered ${rows.length} item(s).`)
    }

    done += 1
    if (opts.note) await opts.note(`Processed ${done}/${batches.length}: ${label}`)
    return rows
  }))

  return { rows: lists.flat(), warnings, batchErrors, batchCount: batches.length }
}
