import { PRESENTATION_BLOCKS_VERSION } from './constants'

/**
 * The Server-Sent Events contract for `POST /api/v1/chat/stream`.
 *
 * SSE rather than newline-delimited JSON: it has a defined framing (`data:` lines, blank-line
 * terminated), so a proxy that buffers or re-chunks cannot split one event into two half-events the
 * way raw NDJSON can. The cost is that the body is text and each event is one line of JSON.
 *
 * EVERY EVENT CARRIES `version`, `type`, `conversationId` and a monotonically increasing
 * `sequence`. The sequence is what lets a client detect a gap rather than silently render a
 * partial run, and it is per-response — not global, not persisted.
 *
 * WHAT EVENTS MAY CONTAIN. Nothing a viewer could not already ask for through the same principal.
 * Tool events carry a name and a display label, never arguments or result previews: an argument can
 * name a company the final answer would not have mentioned. The terminal `message.completed` is the
 * authority — it carries the persisted reply, the blocks and any staged actions, and a client that
 * saw only that event has the whole answer.
 */

export const STREAM_PROTOCOL_VERSION = 1

export type StreamEventType =
  | 'conversation.started'
  | 'tool.started'
  | 'tool.completed'
  | 'block.completed'
  | 'approval.required'
  | 'message.completed'
  | 'error'

export interface StreamEnvelope {
  version: number
  type: StreamEventType
  conversationId: string | null
  sequence: number
  requestId: string
  data: Record<string, unknown>
}

/**
 * A sequencer bound to one response.
 *
 * `message.delta` is deliberately absent from this version. The provider abstraction returns a
 * resolved result from every method, so there is no incremental text to forward without reshaping
 * `AIProvider` and every caller of it. Clients must therefore not assume deltas arrive before
 * `message.completed`; a later protocol version can add them without breaking one that doesn't.
 */
export function createEventStream(requestId: string) {
  const encoder = new TextEncoder()
  let sequence = 0
  let conversationId: string | null = null

  return {
    /** Later events carry the id the run assigned, once it is known. */
    setConversationId(id: string | null) {
      conversationId = id
    },
    encode(type: StreamEventType, data: Record<string, unknown> = {}): Uint8Array {
      const envelope: StreamEnvelope = {
        version: STREAM_PROTOCOL_VERSION,
        type,
        conversationId,
        sequence: sequence++,
        requestId,
        data,
      }
      // `event:` as well as `data:` so a browser EventSource can subscribe by type; a plain reader
      // can ignore it and parse the JSON, which is what URLSession will do.
      return encoder.encode(`event: ${type}\ndata: ${JSON.stringify(envelope)}\n\n`)
    },
    get blocksVersion() {
      return PRESENTATION_BLOCKS_VERSION
    },
  }
}

/**
 * Headers an SSE response needs to survive the trip.
 *
 * `X-Accel-Buffering: no` is the one that is easy to omit and hard to debug: a buffering proxy will
 * otherwise hold every event until the response ends, which looks exactly like streaming not being
 * implemented at all.
 */
export function sseHeaders(requestId: string): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Request-ID': requestId,
  }
}
