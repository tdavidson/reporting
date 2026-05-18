# Call Transcription Ingestion — Build Plan

Add Zoom / Google Meet call transcripts to the diligence data room so they flow through the existing memo-agent ingest pipeline alongside PDFs, decks, and spreadsheets.

## Decisions locked in

- **Transcription vendor: Deepgram** (Nova-3 or current flagship). Picked over Whisper for speaker diarization, over Gemini for quality consistency, over AssemblyAI on cost.
- **Source of recordings: Google Drive only for v1.** Zoom OAuth and Recall.ai bot are deferred.
- **Already-transcribed inputs**: support `.vtt` / `.srt` / Zoom JSON directly — skip Deepgram entirely when the file is already a transcript.
- **Size-based routing**:
  - **Small files** (≤ ~200 MB audio, configurable) → copy from Drive into Supabase Storage, then send Supabase signed URL to Deepgram.
  - **Large files** (video, long calls) → do not copy. Generate a short-lived Drive download URL and hand that directly to Deepgram. Keeps Supabase Storage costs down and avoids round-tripping multi-GB video.
- **Reasoning model stays Claude.** Deepgram transcribes; the existing `runIngest()` Anthropic call extracts claims/objections/follow-ups from the transcript text.
- **Branch**: `claude/zoom-transcription-ingestion-pzhvu`.

## Architecture summary

Recording (Drive) → `diligence_documents` row (`detected_type='call_recording'`)
  → enqueue `memo_agent_jobs.kind='transcribe'`
  → worker dispatches to `runTranscribeJob()`
  → Deepgram async + webhook callback
  → transcript text written as a **second** `diligence_documents` row (`detected_type='call_transcript'`, `source_document_id` → recording)
  → optional structured turns in `diligence_call_transcripts`
  → auto-enqueue existing `kind='ingest'` job on the transcript document
  → memo draft updated as usual

Everything after the transcript row exists today. The build is the path from recording → transcript row.

## Build order (PR-sized chunks)

### PR 1 — Schema + type/kind additions

New migration `supabase/migrations/2026xxxx_call_transcripts.sql`:

- Extend `diligence_documents.detected_type` allowed values: add `'call_recording'`, `'call_transcript'`.
- Add nullable column `diligence_documents.source_document_id uuid references diligence_documents(id) on delete set null` — links transcript back to its recording.
- Extend `memo_agent_jobs.kind` check constraint: add `'transcribe'`.
- New table `diligence_call_transcripts` for structured per-turn data:
  ```
  id uuid pk default gen_random_uuid()
  document_id uuid not null references diligence_documents(id) on delete cascade
  deal_id uuid not null references diligence_deals(id) on delete cascade
  fund_id uuid not null references funds(id) on delete cascade
  speaker text                -- "Speaker 0", or resolved name if mapped later
  speaker_label text          -- optional human-mapped name (set via UI later)
  start_ms integer not null
  end_ms integer not null
  text text not null
  created_at timestamptz not null default now()
  ```
  Index on `(document_id, start_ms)`.
- **Required**: include explicit Data API grants + RLS + policies per `CLAUDE.md` conventions:
  - `grant select on public.diligence_call_transcripts to anon;`
  - `grant select, insert, update, delete on public.diligence_call_transcripts to authenticated, service_role;`
  - `alter table ... enable row level security;`
  - SELECT policy mirroring the `diligence_documents` policy (fund_members join).
- New storage bucket `diligence-recordings` (separate from `diligence-documents` so retention policy can differ — raw audio is large and may be deletable after transcription).
  - Bucket RLS scoped by fund_id, mirror pattern from `20260508000001_memo_agent_buckets.sql`.
- Do not edit historical migrations. Do not apply remotely — repo owner runs `supabase db push`.

### PR 2 — `.vtt` / `.srt` parser branch (zero-cost path)

Lets users upload an already-transcribed file (Zoom's native transcript, Meet's caption export, etc.) and skip Deepgram.

- Extend `classifyDocumentHeuristic()` to detect `.vtt`, `.srt`, and Zoom transcript JSON → `detected_type='call_transcript'`.
- Add parser branch in `lib/memo-agent/ingestion/parsers.ts`:
  - `.vtt` / `.srt`: parse cues into `{speaker?, start_ms, end_ms, text}` array; flatten to plain text for the ingest stage; store turns in `diligence_call_transcripts`.
  - Zoom transcript JSON: same shape, different field names.
- No new job kind needed — these are already transcripts, so they flow through the existing `ingest` job.
- Test fixtures: drop a sample `.vtt` and Zoom JSON under `lib/memo-agent/ingestion/__fixtures__/`.

### PR 3 — Deepgram integration (the main event)

This is the PR that answers "transcribe a call that was never transcribed."

**New module `lib/transcription/deepgram.ts`**:
- Single-purpose client wrapping Deepgram's prerecorded async API.
- Config: `DEEPGRAM_API_KEY` env var. Add to `.env.example` and document in `SETUP.md`.
- Options enabled: `diarize=true`, `punctuate=true`, `paragraphs=true`, `smart_format=true`, `model='nova-3'` (or current flagship at build time), `utterances=true`.
- Two submit methods:
  - `submitFromUrl(url, callback_url, metadata)` — for large files (Drive direct URL).
  - `submitFromBuffer(buffer, ...)` — only used if we ever upload synchronously; default to URL path.
- Use Deepgram's **callback** parameter so transcription is asynchronous — Deepgram POSTs to our webhook when done. Avoids holding a cron worker open for the duration of a long transcription (your worker self-heals stuck jobs after 6 min).

**New job handler `lib/memo-agent/jobs/transcribe-job.ts`**:
- Input: `{document_id, source: 'drive' | 'storage', drive_file_id?, storage_path?, size_bytes}`.
- Threshold: `TRANSCRIPTION_INLINE_BYTES` (default 200 MB) decides path.
  - **Below threshold**: download from Drive (using existing `lib/google/drive.ts`), upload to `diligence-recordings` bucket, generate Supabase signed URL (~30 min TTL), submit to Deepgram with that URL + callback.
  - **At or above threshold**: skip the Supabase copy. Generate a short-lived Drive direct-download URL (Drive API supports `alt=media` with a short-lived access token), submit that to Deepgram. Note: Deepgram needs the URL to be reachable for the duration of transcription — confirm TTL is long enough (typical: 1 hour is fine for most calls). If Drive URLs are too short-lived in practice, fall back to: stream Drive → Supabase Storage with a short retention tag, then signed URL.
- Update `memo_agent_jobs.progress_message` at each step ("Copying from Drive", "Submitted to Deepgram", "Awaiting callback").
- **Do not** mark the job complete here. Set status to a new value `'awaiting_callback'` (or reuse `'running'` with a `external_job_id`), persist Deepgram's `request_id` on the job row (add a column for it in PR 1 if needed, or store in `payload`).

**New webhook route `app/api/webhooks/transcription/route.ts`**:
- Receives Deepgram callback. Validate via Deepgram's signature header.
- Look up `memo_agent_jobs` row by `request_id`.
- Parse Deepgram response: extract diarized utterances.
- Write plain-text transcript file to `diligence-documents` bucket at `{deal_id}/transcripts/{recording_id}.txt`.
- Insert new `diligence_documents` row: `detected_type='call_transcript'`, `source_document_id=recording_id`, `parse_status='parsed'`.
- Bulk-insert utterances into `diligence_call_transcripts`.
- Mark transcribe job complete.
- **Auto-enqueue** an `ingest` job for the new transcript document so it flows into the memo draft without a second user action.
- Webhook must use the service-role client; it has no user auth context.

**Worker dispatch update** (`app/api/cron/memo-agent-worker/route.ts`):
- Add `case 'transcribe': return runTranscribeJob(...)` to the existing switch.
- Update the stuck-job-recovery timeout: transcribe jobs may legitimately sit in `awaiting_callback` for >6 min while Deepgram works. Either extend the timeout for that kind specifically, or only apply the 6-min rule to jobs in `'running'` without an `external_job_id`.

**UI plumbing** (minimal):
- Data room document row shows `parse_status` already. Add a small "Transcribing…" pill driven by the transcribe job's `progress_message`. The existing memo-agent progress component (already polls `memo_agent_jobs`) can be reused.

### PR 4 — Drive folder ingestion: route recordings to transcribe job

Extend `app/api/diligence/[id]/documents/from-drive/route.ts`:

- When walking a Drive folder, classify each file by MIME:
  - `audio/*` or `video/*` → create `diligence_documents` row with `detected_type='call_recording'`, then enqueue a `transcribe` job (don't go through ingest first).
  - `text/vtt`, `application/x-subrip`, or Zoom transcript JSON → existing path with the new parser from PR 2.
  - Everything else → existing path.
- For audio/video, decide size routing per the PR 3 threshold. Below threshold, stream Drive → Supabase. Above threshold, store only the Drive file ID + size on the document row (skip the Supabase copy entirely; `storage_path` stays null and the document is logically "external"). May need a `external_source` jsonb column on `diligence_documents` — add in PR 1 if not already there.

## Open questions to resolve before coding

1. **Audio extraction from video**: a 2-hour Zoom MP4 is huge. Worth running `ffmpeg` server-side to strip to mono 16kHz Opus before transcription? Cuts file size 10–50×. Adds an `ffmpeg` system dependency on Vercel — not free. Probably skip for v1 since Deepgram accepts video directly; revisit if storage costs bite.
2. **Recording retention**: keep raw audio forever, or delete after successful transcription? Diligence audit trail probably wants it kept. Default: keep. Make it a per-fund setting later.
3. **Speaker name mapping**: Deepgram returns "Speaker 0/1/2". The UI should let a user label them ("Speaker 0 = Founder Jane"). Defer to a v1.1; just store the raw label for now.
4. **Cost guardrails**: add per-fund monthly transcription minute cap in `lib/memo-agent/cost.ts` style. Reject enqueue when cap hit. Numbers: at ~$0.26/hr a fund running 20 founder calls/month is ~$10. Cheap, but still want a kill switch.
5. **Webhook security**: confirm Deepgram signature verification approach. If they don't sign, use a per-request shared secret in the callback URL path.

## Files that will change / be created

**New:**
- `supabase/migrations/2026xxxx_call_transcripts.sql`
- `lib/transcription/deepgram.ts`
- `lib/memo-agent/jobs/transcribe-job.ts`
- `app/api/webhooks/transcription/route.ts`
- `lib/memo-agent/ingestion/__fixtures__/sample.vtt`
- `lib/memo-agent/ingestion/__fixtures__/zoom-transcript.json`

**Edited:**
- `lib/memo-agent/ingestion/parsers.ts` — add VTT/SRT/Zoom-JSON branch.
- `lib/memo-agent/ingestion/classify.ts` (or wherever `classifyDocumentHeuristic` lives) — add new detected types.
- `app/api/cron/memo-agent-worker/route.ts` — dispatch `transcribe`, adjust stuck-job timeout.
- `app/api/diligence/[id]/documents/from-drive/route.ts` — route audio/video to transcribe job, handle size threshold.
- `.env.example`, `memo_agent_handoff/SETUP.md` — `DEEPGRAM_API_KEY`, `TRANSCRIPTION_INLINE_BYTES`, webhook secret.

## Not in scope (explicit punts)

- Zoom OAuth / Zoom Cloud Recording API
- Recall.ai bot
- Live transcription
- Speaker name mapping UI
- Semantic search over transcripts (pgvector)
- ffmpeg pre-processing
