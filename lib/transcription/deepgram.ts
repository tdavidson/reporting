/**
 * Deepgram speech-to-text client.
 *
 * Diligence calls are submitted to Deepgram's prerecorded async API. The
 * worker hands Deepgram a signed URL to the audio plus a callback URL on our
 * own webhook; Deepgram POSTs the transcript back when it's ready. This
 * avoids holding a Vercel function open for the duration of a long call.
 */

const DEEPGRAM_API = 'https://api.deepgram.com/v1/listen'

export interface DeepgramSubmitResult {
  /** Deepgram's request_id — opaque handle we use to match the webhook back to our job row. */
  request_id: string
}

export interface DeepgramSubmitInput {
  /** Public-reachable URL Deepgram can fetch the audio/video from. */
  source_url: string
  /** Our webhook URL Deepgram will POST the result to. */
  callback_url: string
  /** Free-form metadata echoed back on the callback (1k char max per Deepgram). Stored as a string. */
  external_ref: string
}

export interface DeepgramUtterance {
  speaker: string | null
  start_ms: number
  end_ms: number
  text: string
}

export interface ParsedDeepgramCallback {
  request_id: string
  external_ref: string | null
  utterances: DeepgramUtterance[]
  /** Concatenated transcript text (joined utterances). */
  full_text: string
  duration_seconds: number | null
}

/**
 * Submit an audio/video URL for prerecorded transcription. Returns
 * immediately with Deepgram's request_id; the actual transcript arrives at
 * the callback URL later.
 */
export async function submitForTranscription(input: DeepgramSubmitInput): Promise<DeepgramSubmitResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY not configured')

  const url = new URL(DEEPGRAM_API)
  url.searchParams.set('model', process.env.DEEPGRAM_MODEL ?? 'nova-3')
  url.searchParams.set('smart_format', 'true')
  url.searchParams.set('punctuate', 'true')
  url.searchParams.set('diarize', 'true')
  url.searchParams.set('paragraphs', 'true')
  url.searchParams.set('utterances', 'true')
  url.searchParams.set('callback', input.callback_url)
  // Tag the request so the webhook handler can correlate to our job row
  // without round-tripping the request_id (which Deepgram doesn't echo in
  // the request body but does provide in the response metadata).
  url.searchParams.set('tag', input.external_ref)

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: input.source_url }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Deepgram submit failed (${res.status}): ${text}`)
  }
  const data = await res.json() as { request_id?: string }
  if (!data.request_id) throw new Error('Deepgram response missing request_id')
  return { request_id: data.request_id }
}

/**
 * Parse Deepgram's webhook payload (the prerecorded async response body) into
 * a stable shape this codebase can store. Defensive about missing fields —
 * Deepgram's schema is large and not all options are populated for every job.
 */
export function parseCallbackPayload(body: unknown): ParsedDeepgramCallback {
  const obj = body as Record<string, any>
  const metadata = obj?.metadata ?? {}
  const requestId = typeof metadata.request_id === 'string' ? metadata.request_id : ''
  const externalRef = typeof metadata.tags === 'object' && Array.isArray(metadata.tags) && metadata.tags.length > 0
    ? String(metadata.tags[0])
    : (typeof metadata.tag === 'string' ? metadata.tag : null)
  const duration = typeof metadata.duration === 'number' ? metadata.duration : null

  // Preferred shape: results.utterances[] when utterances=true was set.
  const rawUtterances = obj?.results?.utterances as Array<Record<string, any>> | undefined
  const utterances: DeepgramUtterance[] = []
  if (Array.isArray(rawUtterances)) {
    for (const u of rawUtterances) {
      const speakerIdx = typeof u.speaker === 'number' ? u.speaker : null
      const start = typeof u.start === 'number' ? Math.round(u.start * 1000) : 0
      const end = typeof u.end === 'number' ? Math.round(u.end * 1000) : start
      const text = typeof u.transcript === 'string' ? u.transcript.trim() : ''
      if (!text) continue
      utterances.push({
        speaker: speakerIdx !== null ? `Speaker ${speakerIdx}` : null,
        start_ms: start,
        end_ms: end,
        text,
      })
    }
  } else {
    // Fallback: take the first alternative's plain transcript as a single utterance.
    const transcript = obj?.results?.channels?.[0]?.alternatives?.[0]?.transcript
    if (typeof transcript === 'string' && transcript.trim()) {
      utterances.push({
        speaker: null,
        start_ms: 0,
        end_ms: duration ? Math.round(duration * 1000) : 0,
        text: transcript.trim(),
      })
    }
  }

  const full_text = utterances
    .map(u => {
      const ts = formatStartMs(u.start_ms)
      const speaker = u.speaker ? `${u.speaker}: ` : ''
      return `[${ts}] ${speaker}${u.text}`
    })
    .join('\n')

  return { request_id: requestId, external_ref: externalRef, utterances, full_text, duration_seconds: duration }
}

function formatStartMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
