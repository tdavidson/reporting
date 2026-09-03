import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashCallbackToken, mintCallbackToken } from '@/lib/transcription/callback-token'

/**
 * SEC-010. The callback URL carried one shared secret for the whole endpoint, in the path — copied
 * into every proxy access log and tracing span that records a path, and good for ANY job whose id
 * an attacker could guess. Deepgram does not sign prerecorded callbacks, so the URL is the only
 * channel available; what changed is that it now carries a credential minted for one job.
 *
 * The shared secret survived one deployment as a fallback and has been removed. The test that
 * matters most here is the third: knowing a job id is no longer worth anything.
 *
 * These tests are about the door, not what happens past it: the transcript-writing path is mocked.
 */

const mocks = vi.hoisted(() => ({
  jobs: [] as Record<string, any>[],
  documents: [] as Record<string, any>[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const source = () => (table === 'memo_agent_jobs' ? mocks.jobs : mocks.documents)
      const filters: Array<(r: any) => boolean> = []
      let patch: Record<string, any> | null = null
      const settle = () => {
        const rows = source().filter(r => filters.every(f => f(r)))
        if (patch) for (const r of rows) Object.assign(r, patch)
        return rows
      }
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push(r => r[column] === value)
          return chain
        },
        update: (values: Record<string, any>) => {
          patch = values
          return chain
        },
        insert: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: settle()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
          Promise.resolve({ data: settle(), error: null }).then(resolve, reject),
      }
      return chain
    },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }),
}))
vi.mock('@/lib/transcription/deepgram', () => ({
  parseCallbackPayload: (body: any) => ({
    request_id: body.request_id ?? null,
    external_ref: body.external_ref ?? null,
    utterances: [],
    duration_seconds: 0,
    text: '',
  }),
}))
vi.mock('@/lib/ai/usage', () => ({ logAIUsage: async () => {} }))
vi.mock('@/lib/memo-agent/render/gdoc', () => ({ uploadTranscriptToDrive: async () => null }))
vi.mock('@/lib/google/drive', () => ({ parseDriveFolderUrl: () => null }))

import { POST } from '@/app/api/webhooks/transcription/[token]/route'

const token = mintCallbackToken()

function job(over: Record<string, any> = {}) {
  return {
    id: 'job-1',
    fund_id: 'fund-1',
    deal_id: 'deal-1',
    payload: {},           // no document_id: the request stops right after auth, which is the part under test
    status: 'running',
    external_job_id: 'dg-1',
    callback_token_hash: hashCallbackToken(token),
    ...over,
  }
}

const call = (pathValue: string, body: Record<string, unknown> = {}) =>
  POST(
    new Request('https://reporting.test/api/webhooks/transcription/x', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }) as any,
    { params: Promise.resolve({ token: pathValue }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.jobs = [job()]
  mocks.documents = []
})

describe('the per-job callback token', () => {
  it('authenticates AND addresses: presenting the token finds its own job', async () => {
    // 400 for the missing document_id means it got past auth to the job it was minted for, which
    // is what this asserts. A 401 would mean the token was not accepted.
    const response = await call(token, {})
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('document_id') })
  })

  it('refuses a token that matches no job', async () => {
    const response = await call(mintCallbackToken(), { external_ref: 'job-1' })
    expect(response.status).toBe(401)
  })

  it('refuses a caller who knows the JOB ID but not the token', async () => {
    // The old scheme's weakness: the shared secret plus a guessable tag was enough. Now the tag
    // alone gets nowhere.
    const response = await call('not-the-token', { external_ref: 'job-1', request_id: 'dg-1' })
    expect(response.status).toBe(401)
  })

  it('refuses a caller presenting only a payload, with no credential in the path at all', async () => {
    expect((await call('', { external_ref: 'job-1', request_id: 'dg-1' })).status).toBe(401)
  })

  it('gives the same 401 for a bad token and for an unknown job, so neither can be enumerated', async () => {
    const badToken = await call('wrong', { external_ref: 'job-1' })
    mocks.jobs = []
    const noJob = await call(token, { external_ref: 'nope' })
    expect(badToken.status).toBe(401)
    expect(noJob.status).toBe(401)
    expect(await badToken.json()).toEqual(await noJob.json())
  })

  it('is spent once the job reaches a terminal state', async () => {
    await call(token, {})
    // The missing-document_id path marks the job failed, which clears the token with it.
    expect(mocks.jobs[0].callback_token_hash).toBeNull()
    expect((await call(token, {})).status).toBe(401)
  })

  it('does not accept a job that already succeeded — Deepgram retries are deduped', async () => {
    mocks.jobs = [job({ status: 'success' })]
    const response = await call(token, {})
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ deduped: true })
  })
})
