# Architecture

## Overview

```
Browser (React SPA) ──REST──▶ Express API (Node) ──▶ Gemini API (server only)
      │                           │
      │ onSnapshot (own events)   ├──▶ Firestore (Admin SDK)
      └───────────────────────────┤──▶ Firebase Storage
                                  └──▶ Public web (fetch pages and PDFs)
```

- **`src/shared`** holds the single Zod schema set used by client and server: records, agent outputs, API bodies and events.
- **`src/server`** contains the API, agents, research, the stage runner and the validators. The Gemini key is read only here.
- **`src/client`** is React, Tailwind, Framer Motion and Lucide. Routes are lazy-loaded, and Firestore is loaded lazily, only on the Live Investigation page.

## Execution model

I checked what the runtime provides first. A Node API server on Google AI Studio's full-stack runtime (Cloud Run style) offers no queue, task service or durable worker, and instances may be stopped between requests. So I chose the **resumable server-side stage runner** described in PART 10.1.

### How a job starts

`POST /api/verifications` creates the submission and the job in one transaction. The same transaction enforces the idempotency key and the daily quota, and writes the first event. The browser then opens `/investigations/:jobId`.

### How stages run

While the Live Investigation page is open, it calls `POST /api/verifications/:jobId/advance` in a loop. Each call does the following:

1. Recomputes the stage graph from stored data (`pipeline/plan.ts`).
2. Picks up to `CLAIM_CONCURRENCY` ready stages, at most one per claim (default 3).
3. Runs those stages concurrently and persists their output.
4. Returns the job view to the browser.

The stage graph for each confirmed claim is:

```
extract_claims (+ audit for documents, in parallel)
  → [student confirms claims and topics]
  → triage → research_plan → research_search → research_read → research_refine
  → debate steps (fast: r1, r2, r3 | full: r1, r2a, r2b, r3, r4)
  → judge → pedagogue
→ finalize
```

Every stage is short enough to finish inside a single request. The time limit is `PIPELINE.maxStageMs`, 4 minutes by default. Research is split into four stages for this reason, and the debate runs one step per stage.

### How results are persisted and duplicates are prevented

- Each stage is a `stageRuns/{stageKey}` record. A Firestore transaction acquires a **lease** before the stage runs (`leaseOwner`, `leaseExpiresAt`).
- A second advance call that loses the race gets `false` back and simply returns the current status.
- A stage's output is written in the same transaction that marks it `completed`, and only if the lease is still held. Output from a process that lost its lease is discarded.
- Completed stages are never run again.
- Output document IDs are deterministic (for example `{claimId}_E3` and `{debateId}_{step}_{side}_{n}`), so a retried stage overwrites its own earlier partial records instead of duplicating them.

### Retries and resume

- A failed stage returns to `pending` with exponential backoff (`nextRetryAt`). There are at most `maxStageAttempts` attempts, 3 by default.
- Invalid AI output (`AI_OUTPUT_INVALID`, after the one repair retry) and configuration errors are not retried. A missing or invalid Gemini key fails the whole job with the setup message.
- If a server dies mid-stage, its lease expires. The next advance call re-acquires the stage, marks it `STALLED` and runs it again.

### What happens when the browser is closed

Nothing runs. The current stage finishes or its lease expires, and no new stage starts.

If no advance call arrives for `pauseAfterIdleMs` (45 seconds) and no live lease exists, the next status read stores `paused`. It also writes the event "The investigation is paused and will resume when you reopen it." Reopening the page resumes from the first incomplete stage. The app never claims that processing continues in the background.

### Supersede and cancel

Editing a topic after confirmation, retrying, or running a deeper investigation creates a **new job** with copied, already-confirmed claims. A still-running old job becomes `superseded`, with `supersededBy` set. Each job has its own events subcollection, so the animation never shows another job's events.

## Events and the animation

- Each real action writes an `events/{seq}` record: a stage start, finish or failure, a research log entry, a saved evidence record, a debate message, the judge decision, a quality finding, an extraction page or the lesson. Sequence numbers are reserved on the job document inside the same transaction that writes the source record.
- Each event stores a `ref` to the record it represents, and a `summary` copied from that record.
- The browser loads past events through the paginated API, then subscribes to newer events with `onSnapshot`. Teachers, who have read-only access, poll the API instead.
- **Virtual courtroom.** The page shows one card per claim plus an Overview card for document-level work. Each card shows the claim's current step, real progress and verdict. Selecting a card plays only that claim's events (or the job-level events for Overview), so parallel claims never overwrite each other on screen. Each courtroom keeps its own playback position.
- Playback has a minimum display time and catches up automatically when behind. While a job is live there is no speed control; replays can be sped up, skipped, scrubbed on a timeline or restarted. Consecutive research steps of one stage are grouped in the text transcript.
- Event text is built in the browser from stored facts (for example a research step's site and failure reason), so it follows the interface language. Labels use the language's separator (`՝` in Armenian).
- Agents whose stage is running keep a "working" animation (the Researcher's magnifying glass, the Claim Extractor's highlighter) even between events.
- The backend never waits on the animation.

## Answer format and the Gemini schema

Each agent call sends its Zod schema to Gemini as `responseJsonSchema` (`ai/jsonSchema.ts`). The topic-lock IDs are pinned as single-value enums. Length limits, patterns and item counts are written into field descriptions rather than sent as keywords, because Gemini compiles the schema into a decoding grammar with a size limit. If the API still refuses a schema with HTTP 400, that call is retried with the schema written into the prompt, and the schema is not sent again until the server restarts (`ai/structured.ts`). Zod validation in code stays the authority either way.

## Firestore indexes

Queries that filter on one field and sort on another need the composite indexes in `firestore.indexes.json`. Until they exist, `firestoreQuery.ts` runs the equality-only query and sorts in memory (bounded at 1,000 rows), and logs one `Firestore index missing` warning with Firestore's `createIndexLink` for each such query. The emulator never enforces indexes, so `unit/firestore-query.test.ts` simulates the production error.

## Measured timings

Every stage run stores `durationMs` and `aiCalls`. When a job finishes, the server logs one `job finished` line with the wall time, the active processing time (pauses excluded), AI calls, claim complexity and the average and maximum duration per stage type. It contains no user content. The admin Performance view shows the same data from Firestore.

## Caching (PART 10.7)

- **`searchCache`** and **`pageCache`** store public web data only. Keys are the normalized query or URL plus language. The TTL depends on time sensitivity: 7 days for `stable` claims and 3 hours for `time_sensitive` ones.
- **Final results are never reused as a shortcut.** During confirmation, a matching past result from the **same user** appears as "You verified a matching claim on {date}", with a link to it. Time-sensitive matches are marked as history only. Confirming always runs a fresh investigation.
- Private documents and results are never written to the shared caches.

## Knowledge base (vector search before web search)

Before the first web search for a claim, `research_plan` searches stored passages. The code is in `src/server/kb/`.

- **What is stored.** Passages (about 800 characters) with a 768-dimension Gemini embedding (`GEMINI_MODEL_EMBED`, default `gemini-embedding-001`). Two collections, never mixed in one query:
  - `kbPublic`: pages fetched for `stable` claims, plus any Wikipedia articles seeded with `npm run kb:seed`. `kbSources` records one row per page for de-duplication.
  - `kbClassroom`: teacher materials, each passage tagged with its `classroomId`.
- **Student uploads are never indexed.** Only public pages and teacher materials are.
- **Classroom isolation.** The `classroomId` for a search comes from the job record (set from the assignment, with membership checked at submission). It is never read from a request or from model output. The query filters on it, the results are checked against it again, and a search without a classroom id is refused. Only the classroom's teacher can add, list or delete materials. Material text and titles are never put in the query planner's prompt, so they cannot reach a web search.
- **How hits are used.** Stored passages go through the same source assessment and verbatim-excerpt check as fetched pages, so `quote_verified` still means the quote is in the stored text. Evidence is marked `knowledge_base` or `classroom_material` and shows when the text was fetched or uploaded, not today's date.
- **Skipping the web.** If enough independent sources match strongly (`KB_STRONG_SIMILARITY`, at least the budget's target number of distinct domains), the planner and the first round of searches are skipped. If the assessed evidence is still not sufficient, the refine stage searches the web with up to 6 queries. Similarity only chooses what to assess. It never decides whether a claim is supported.
- **Independence.** The hy, ru and en Wikipedias count as one source (`wikipedia.org`), and all teacher materials in a classroom count as one source, so neither alone satisfies a target of two or more.
- **Freshness.** Public passages are used only for `stable` claims and only if fetched within `KB_PUBLIC_MAX_AGE_DAYS` (90). Time-sensitive claims never use them. Teacher materials are used for every claim.
- **Failure mode.** If embedding, the vector index or the query fails, research continues exactly as before with the web search.
- **Write-back.** Pages fetched for a stable claim are indexed while the assessment runs. Indexing errors are logged and ignored.

## Security model

- The Admin SDK bypasses Firestore rules, so every route verifies the ID token (`requireAuth`) and checks ownership or classroom-teacher access (`access.ts`). Missing records and records owned by someone else both return `NOT_FOUND`.
- Roles live in `users/{uid}.role` and are mirrored to custom claims. Only an administrator can change a role; a user can never set their own. The first administrator comes from `BOOTSTRAP_ADMIN_EMAILS`, and only with a verified email.
- Clients can read their own job document, its events and stage runs, and their notifications. They cannot write anything. See `firestore.rules`.
- Storage rules deny all client access. Files go through the server, which checks the MIME type from magic bytes, the size and the owner.
- Outbound fetches refuse private and loopback addresses, which protects against SSRF.
- The logger redacts secrets. Logs never contain document text.

## Validation layers (PART 0.4 / 9)

| Layer | Implementation |
|---|---|
| A. Provenance | `provenanceStatus`, `urlOrigin` and `failureReason`. `verifyExcerpt` does a whitespace-normalized verbatim match against the fetched text. The UI labels come from the stored status. |
| B. Source quality | `qualityAssessment` per source (five ratings with rationales). |
| C. Claim support | The Researcher's relation is stored as provisional. The Defender and the Prosecutor each re-assess it, quoting the passage they rely on verbatim; the quote is verified in code. Records also carry `directness` and `conditionsMatch`. |
