import { describe, it, expect } from 'vitest'
import { parseCallbackPayload } from './deepgram'

describe('parseCallbackPayload', () => {
  it('parses utterances with speaker diarization', () => {
    const payload = {
      metadata: {
        request_id: 'abc-123',
        tag: 'job-uuid-7',
        duration: 12.5,
      },
      results: {
        utterances: [
          { speaker: 0, start: 0.5, end: 3.2, transcript: 'Hello, this is the founder.' },
          { speaker: 1, start: 3.5, end: 6.0, transcript: 'Good to meet you.' },
          { speaker: 0, start: 6.2, end: 12.5, transcript: 'Let me walk you through the deck.' },
        ],
      },
    }
    const result = parseCallbackPayload(payload)
    expect(result.request_id).toBe('abc-123')
    expect(result.external_ref).toBe('job-uuid-7')
    expect(result.duration_seconds).toBe(12.5)
    expect(result.utterances).toHaveLength(3)
    expect(result.utterances[0]).toEqual({
      speaker: 'Speaker 0',
      start_ms: 500,
      end_ms: 3200,
      text: 'Hello, this is the founder.',
    })
    expect(result.utterances[1].speaker).toBe('Speaker 1')
    expect(result.full_text).toContain('[00:00] Speaker 0: Hello')
    expect(result.full_text).toContain('[00:06] Speaker 0: Let me walk')
  })

  it('falls back to channel alternative transcript when utterances missing', () => {
    const payload = {
      metadata: { request_id: 'r', duration: 60 },
      results: {
        channels: [{ alternatives: [{ transcript: 'Single line transcript.' }] }],
      },
    }
    const result = parseCallbackPayload(payload)
    expect(result.utterances).toHaveLength(1)
    expect(result.utterances[0].text).toBe('Single line transcript.')
    expect(result.utterances[0].speaker).toBeNull()
    expect(result.utterances[0].end_ms).toBe(60000)
  })

  it('handles tags as an array (Deepgram metadata.tags shape)', () => {
    const payload = {
      metadata: { request_id: 'r', tags: ['job-xyz'] },
      results: { utterances: [] },
    }
    const result = parseCallbackPayload(payload)
    expect(result.external_ref).toBe('job-xyz')
  })

  it('drops utterances with empty text', () => {
    const payload = {
      metadata: { request_id: 'r' },
      results: {
        utterances: [
          { speaker: 0, start: 0, end: 1, transcript: '   ' },
          { speaker: 0, start: 1, end: 2, transcript: 'Real text.' },
        ],
      },
    }
    const result = parseCallbackPayload(payload)
    expect(result.utterances).toHaveLength(1)
    expect(result.utterances[0].text).toBe('Real text.')
  })
})
