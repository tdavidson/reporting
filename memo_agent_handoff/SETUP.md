# Setting Up the Memo Agent as a Claude Project

This guide takes you from "I have these files" to "I've drafted my first memo." About 20 minutes if you have a Drive data room ready.

## 0. What you need

- A Claude account (claude.ai) on a paid plan that supports Projects.
- A Google Drive folder with at least one deal's data room. The folder can contain PDFs, decks, Excel files, Word docs — whatever the company sent you.
- Optional but high-value: 3-5 prior investment memos your firm has written, to teach the agent your voice. PDFs or Word docs work.

## 1. Create the project

1. In Claude, create a new Project. Call it whatever (e.g., "Memo Agent").
2. Open Project Settings → Instructions.
3. Paste the contents of `project_instructions.md` into the Instructions field. Save.

## 2. Add the project knowledge files

Upload these seven files to the project's knowledge:

- `instructions.md`
- `rubric.yaml`
- `qa_library.yaml`
- `data_room_ingestion.yaml`
- `research_dossier.yaml`
- `memo_output.yaml`
- `style_anchors.yaml`

These are the agent's operating contract. The agent reads them on every conversation.

## 3. Connect Google Drive

In your Claude account settings, connect the Google Drive integration. The agent needs Drive read access to walk a deal's data room.

(If your firm's data rooms live in Dropbox or somewhere else, you can still use the project — you'll need to download the files and upload them into the conversation directly. Drive is the smoothest path.)

## 4. Upload reference memos (the voice-training step)

This is the highest-leverage thing you can do to make the agent's output sound like your firm.

For each prior memo you want the agent to learn from:

1. Upload the memo file (PDF or DOCX) to project knowledge. Give it a clear name like `anchor_2024_aurora_health.pdf`.
2. Create a metadata file alongside it: `anchor_2024_aurora_health.meta.yaml`. Use `style_anchor_template.meta.yaml` as your starting template — copy it, fill in what you know about the memo (vintage, sector, conviction, voice representativeness, anything to focus on or deprioritize).
3. Upload the metadata file to project knowledge too.

A few notes:

- 1 memo gets you a directional voice match. 3-5 makes it reliable. 8+ makes it robust across authors and vintages.
- Be honest about `voice_representativeness`. If a memo was written under unusual circumstances and doesn't sound like your firm normally does, mark it `do_not_match_voice` so the agent reads it for structure but not tone.
- The metadata is optional. If you skip it, the agent treats every memo as roughly equally representative. The metadata helps; missing it doesn't break anything.

## 5. (Optional) Customize the schemas before your first run

The schemas ship with sensible defaults but every firm is different. You can edit any of the seven YAML files directly in project knowledge before running:

- `rubric.yaml`: are these the seven scoring dimensions you actually use? The 1-5 scale work for you?
- `qa_library.yaml`: do these partner Q&A questions match what you actually want to ask yourself on a deal?
- `memo_output.yaml`: does the memo section list match your firm's template?

You can also skip this and edit later as you find things you want to change. The agent reads these files fresh on every turn, so edits take effect immediately.

## 6. Run your first deal

Start a new chat in the project. The agent will introduce itself and ask what you want to do. Tell it you want to start a new memo and paste your Drive folder URL.

What happens next, in order:

1. **Ingestion.** The agent walks your Drive folder, classifies every document, extracts company-stated claims and financial structure, and runs gap analysis (what's expected but missing). It hands back a summary and asks if you want to correct anything before proceeding.
2. **Research.** External verification of material claims, competitive map (including competitors the company didn't name), founder research from public sources (no LinkedIn). Hands back a research summary highlighting verified claims, contradictions, and gaps.
3. **Q&A.** The agent asks you 4-6 partner questions per batch — about the team, founder-market fit, and dynamics that only you can answer. You answer in chat. It batches a few rounds.
4. **Draft.** The agent assembles the memo with paragraph-level provenance, scores the machine-mode dimensions (everything except team and overall recommendation), and surfaces a "partner attention" list of things you must address before the memo can be considered complete.
5. **Render.** A markdown-formatted memo in chat. The Recommendation and Team Score sections are `[Partner to complete]` — the agent never fills these in. You can ask it to refine specific sections, then export as Word or Google Doc.

Expect the first deal to surface schema issues — questions you'd never ask, scoring criteria that don't match your reality, missing memo sections. Edit the YAML files, run another deal, iterate.

## 7. Sharing the project

If you share this Claude Project with colleagues at your firm, they get the custom instructions automatically. Whether project knowledge files travel with the share depends on your Claude plan — confirm in Claude's documentation. If not, share the seven schema files separately (e.g., over email or a shared Drive folder) and have each user upload them when they create their copy of the project.

For firm-wide rollout — where everyone uses the same schemas and the same reference memos, edits are centralized, and per-deal data is persisted — the right move is the deployed component inside your portfolio reporting tool. See `INTEGRATION.md` for that scoping.

## Troubleshooting

**"The agent skipped the Drive folder and just talked at me."** Your Drive integration probably isn't connected, or the folder isn't accessible to your Claude account. Confirm in account settings.

**"The agent's voice sounds nothing like our firm."** Either no reference memos are uploaded, or fewer than 3 are uploaded. Add more anchors with metadata. Voice quality scales with anchor count up to about 8 memos.

**"The agent tried to score the team / wrote a recommendation."** That's a bug — the schemas explicitly prohibit it. File feedback (thumbs down) so the prompt can be hardened. The schema-level enforcement should catch this in the deployed component; in the Claude Project version it depends on Claude following the operating manual.

**"The agent missed an obvious competitor."** Tell it. Add to the qa_library or surface as a partner attention item directly. The agent runs again with that context next time.

**"It took forever."** A 30-document data room with a financial model takes 5-15 minutes to ingest and research properly. That's the cost of doing it well. The deployed component runs ingestion and research as background jobs so you don't sit and wait.
