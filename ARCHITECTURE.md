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
- The browser loads past events through the paginated API, then subscribes to newer events with `onSnapshot`. Teachers, who have read-only access, poll the API instead. Playback has a minimum display time, speeds up automatically when far behind, and can be paused, sped up, skipped, replayed or scrubbed on a timeline.
- The backend never waits on the animation.

## Caching (PART 10.7)

- **`searchCache`** and **`pageCache`** store public web data only. Keys are the normalized query or URL plus language. The TTL depends on time sensitivity: 7 days for `stable` claims and 3 hours for `time_sensitive` ones.
- **Final results are never reused as a shortcut.** During confirmation, a matching past result from the **same user** appears as "You verified a matching claim on {date}", with a link to it. Time-sensitive matches are marked as history only. Confirming always runs a fresh investigation.
- Private documents and results are never written to the shared caches.

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
