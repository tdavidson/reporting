# Diligence Agent - Claude Project

A pre-investment diligence agent for venture capital firms, packaged as a [claude.ai](https://claude.ai) Project. Drop it in and you have a conversational analog of the diligence workspace from the reporting app - same schemas, same rules, same six-stage flow, no Supabase or Next.js infrastructure required.

The agent ingests a data room, does external research, walks the partner through structured Q&A, drafts a memo with paragraph-level provenance, scores the rubric, and renders the result. It never decides; it compiles, surfaces, drafts, and flags.

## What's in this folder

```
diligence-claude-project/
├── README.md                          this file
├── system-instructions.md             paste into the Project's "Custom instructions" field
└── knowledge/                         upload everything in this folder as Project knowledge
    ├── instructions.md                the agent's full operating manual
    ├── rubric.yaml                    scoring dimensions and criteria
    ├── qa_library.yaml                partner Q&A pool with skip logic
    ├── data_room_ingestion.yaml       per-document extraction shape
    ├── research_dossier.yaml          external research shape, source tiers
    ├── memo_output.yaml               memo section structure, partner-only fields
    └── style_anchors.yaml             metadata schema for uploaded reference memos
```

## Setup (one time, ~5 minutes)

1. Open [claude.ai](https://claude.ai) and go to **Projects** -> **Create Project**.
2. Name it something like "Diligence Agent".
3. Open the new project's **Settings**:
   - Paste the contents of `system-instructions.md` into **Custom instructions**.
   - Upload every file in `knowledge/` as project knowledge. All seven files.
4. (Optional but recommended) Upload 2-4 of your firm's prior investment memos to the same knowledge area. They teach the agent your voice - see `knowledge/instructions.md` Section 7. The agent never copies facts from them; it only learns structure and tone.
5. Save the project.

## How to use it

Open a new chat inside the project and tell the agent what stage you're at. Common starting points:

- **Starting fresh.** "I want to start diligence on [company]. Here's the data room - [drop a Drive URL, paste pitch deck content, or upload files directly to this conversation]. Run Stage 1 ingestion."
- **Resuming.** "We're at Stage 3 (Partner Q&A) for [company]. Here's what we have from ingest and research: [paste the prior outputs]. Continue with the next Q&A batch."
- **Reviewing.** "Read this memo draft and flag anything that violates the hard rules in instructions.md."

The agent will follow the six-stage flow defined in `instructions.md`. It will ask for input where the stage needs it, surface gaps and contradictions, and produce structured outputs at each stage.

## What this Project cannot do

A few things from the reporting app don't translate to claude.ai Projects:

- **No web access by default.** The agent cannot crawl Drive folders, scrape websites, or hit external APIs. For Stage 2 (research) it will rely on its training data plus whatever you paste into the conversation. If your claude.ai workspace has web search enabled, the agent can use it - otherwise it will surface gaps for things it cannot verify, which is the correct behavior per the operating manual.
- **No persistence between sessions.** Each conversation is independent. To resume diligence on a deal, paste the prior stage outputs into a new chat or use the Project's conversation history.
- **No automatic document rendering to Word/Google Doc.** The agent produces structured Markdown that you can copy into a doc. The reporting app's Stage 6 render-to-docx is the part that doesn't exist here.
- **No async batch processing.** The agent works conversationally. If you have a 200-document data room, you will work through it interactively rather than handing it to a worker.

## Customizing the agent for your firm

Three knobs you'll likely want to turn:

1. **The rubric** (`rubric.yaml`). Edit dimensions, criteria, and which ones are machine vs partner-only. Re-upload to the Project knowledge after editing.
2. **The Q&A library** (`qa_library.yaml`). Add or remove questions; tune skip logic. The agent will pull from whatever's in there.
3. **Style anchors** - upload your firm's prior memos. This is the single highest-leverage change you can make. The agent reads them at the start of every diligence session and matches your firm's voice, structure, and analytical patterns. Without them, output is structurally correct but voice-generic.

Editing `instructions.md` directly is also fine but changes the agent's identity - read Section 10 of that file for the versioning model before doing it.

## Provenance

This package is extracted from the open-source [reporting](https://github.com/tdavidson/reporting) repo, where the same schemas and prompts drive a full async agent workflow with paragraph-level provenance, scoring, attention queues, and Word/Google Doc rendering. The Claude Project version trades that infrastructure for portability - you get the agent's brain without the workflow plumbing.
