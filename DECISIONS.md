# Technical decisions

Each entry gives the choice, why it was made, and what it costs. "Spec" means PART 0.1 of the project specification required it.

## The short version

There is no background worker. Each investigation step runs inside a normal HTTP request (`/advance`). Those requests can overlap and can die halfway, so every step needs three protections:

| Protection | Prevents |
|---|---|
| **Lease** | the same step running twice at once |
| **Transaction** | half-saved results, out-of-order events, results from a server that lost its lease |
| **Idempotency** | a repeated request creating duplicates (double click, network retry, stage retry) |

## Stack

| Choice | Why | Cost |
|---|---|---|
| React + TypeScript, Tailwind, Framer Motion, Lucide | Spec. | — |
| Node server, Gemini only on the server | Spec. The key never reaches the browser. | — |
| Firebase Auth, Firestore, Storage | Spec. | Production needs composite indexes (see `firestoreQuery.ts`). |
| Zod, one schema set in `src/shared` | Spec. The same schemas validate API input, agent output and stored records, and generate the JSON schema sent to Gemini. | — |
| Vitest | Spec. | — |
| **Express** | The simplest well-known option for plain JSON routes, one raw upload route and one PDF stream. Anyone can read it. | Older API than Fastify or Hono; this app doesn't need their extras. |
| **Vite** | Standard React build tool: TypeScript, Tailwind, lazy-loaded pages. Its env prefix rule keeps everything except `VITE_FIREBASE_*` out of the browser. | — |
| **React Router** | The usual way to give a React app real URLs with lazy-loaded pages. | — |
| **tsx runs the server** | No separate server compile step, one fewer thing to break on Render. | A few seconds of compilation at startup and extra memory. For production, compile once at build time instead. |
| **firebase-admin on the server; web SDK in the browser only for sign-in and live events** | The spec requires every write and permission check on the server (PART 6.3). The Admin SDK bypasses security rules, so the server checks tokens and ownership itself. | Every protected route must call the auth and ownership helpers. |
| **unpdf, mammoth, PDFKit** | Small, open source, no native dependencies, so they run on any host. | unpdf needs a `Promise.try` polyfill on older Node versions. |
| **Fontsource Noto fonts** | Armenian, Cyrillic and Latin glyphs embedded in the PDF reports. | PDF text is split into runs by script, one font per run. |
| **zod-to-json-schema** | Tells Gemini the exact answer format from the same Zod schemas. Item counts and lengths become description hints, because Gemini limits schema size. | If a schema is refused, the call falls back to sending it in the prompt. |
| **Firebase emulators for tests** | They exercise the real Firestore logic (transactions, leases, security rules) without a cloud project. | They don't enforce indexes, so missing indexes only show up in production. |

## How investigations run

- **The page drives the work.** The open Live Investigation page calls `/advance` in a loop; each call runs the next ready stages. This is honest: closing the tab pauses the job. It's also portable: a real task queue could call the same stage runner instead.
- **Leases** (`stageRuns/{stageKey}` with an owner and an expiry). A stage is claimed atomically before it runs. Anyone else who sees a live claim backs off. An expired claim means the server died, and the next request resumes the stage.
- **Transactions.** A stage's outputs, its events and its "completed" mark are committed together, and only if the lease is still held. Event sequence numbers are reserved in the same transaction, so the animation's order is the real order.
- **Idempotency.** A submission's ID is a hash of the user and a key the browser generates once, so a repeated submission returns the same job. Stage outputs have predictable IDs (for example `{debateId}_{step}_{side}_{n}`), so a retried stage overwrites its own partial output instead of adding duplicates.
- **Capped retries with backoff.** Temporary errors retry up to three times. Invalid AI output and configuration errors fail at once, with the real error shown.

## Knowledge base

| Choice | Why | Cost |
|---|---|---|
| **Firestore vector search** | Already in the stack, no new service, same Admin SDK. | Needs vector indexes (minutes to build). The emulator has no vector search, so tests use an in-process ranking with the same query filters. |
| **Stored passages go through the normal assessor** | A similarity score is not evidence. Keeping the assessment and verbatim-excerpt check means `quote_verified` still means the same thing. | Skipping the web still costs the assessor calls. |
| **One neutral query, not per-side queries** | An embedding of the claim finds topical text, not text that agrees or disagrees. The assessor labels each source's relation. | When the web search is skipped, the Defender and Prosecutor only argue from what the stored passages contain. They are checked by the sufficiency rule and fall back to the web otherwise. |
| **Public passages only for `stable` claims, 90 days** | A stale page is the main way this feature could mislead. | Time-sensitive claims get no latency or cost saving. |
| **Wikipedia counts as one source, and is context only** | The three language editions are one encyclopedia, and the source credibility rules treat Wikipedia as context. | Stored Wikipedia pages never skip the web search, because they could not satisfy the target. They are still shown to the assessor as background. |
| **Separate collections for public and classroom passages** | A query cannot mix them by mistake. | Two vector indexes. |
| **Teacher materials are never described to the query planner** | Planned queries go to a web search. | The planner cannot avoid duplicating what a material already says. |
| **Materials: text only, original file not kept** | Less to protect and delete. | Teachers cannot re-download a material from the app. |

## Source credibility

| Choice | Why | Cost |
|---|---|---|
| **A database and rules decide the tier, not the model** | A language model rating a site's credibility is an educated guess from memory. A list that people curated can be audited and corrected. | The lists describe outlets, not statements. A reliable outlet can still be wrong, and an unlisted outlet gets no help. |
| **The model's rating can only lower the tier** | It can notice things a list cannot (a dated page, a publisher that is a party to the dispute). It must not be able to talk a social network up. | A good site with an odd page can be rated down by a mistaken model. |
| **Unlisted sites are capped at medium** | Only a site someone has vouched for, or one that matches a rule, should ever count as high. | A good unlisted site (for example an Armenian university on `.am`) is medium until it is added to the rules or a list. |
| **Context-only is enforced at every step** | Ranking sources lower is not enough if they can still be the decisive evidence. It is checked in the independence count, the sufficiency rule, the "unsupported" flag and the Judge validator. | Claims that only have social or wiki coverage end as `research_failed` instead of a verdict. This is intended. |
| **The "who said what" exception** | A claim such as "the minister said X" is settled by what the minister's own account says, even though that account cannot show X is true. | The extractor model sets the flag. A wrong flag can only let an owner's own account show that something was said. It never makes a social post evidence of a fact. |
| **Explicit rules beat imported lists; suffix guesses lose to them** | Wikipedia's list rates Wikipedia itself unreliable, but the project chose medium and context only. `.edu` would rate `academia.edu` high, but Wikipedia's list says otherwise. | Two precedence levels to remember. |
| **State ownership is a marker, not a tier** | A state-owned outlet can be accurate and an independent one wrong, so ownership must not change the rating. It is shown so students can ask whose interests the coverage serves. | Coverage is only as complete as the built-in list plus the Wikipedia summaries that say so. An unmarked outlet may still be state-owned. Wikipedia entries listed only by path (such as `dw.com/en`) are skipped, so Deutsche Welle is not marked unless it is added to the built-in list. |
| **Wikipedia: general and current entries decide** | The perennial list splits some sites by topic or period. A topic caveat should not downgrade a whole site. | Topic caveats appear only in the note. |
| **DOAJ is per host, and can only confirm** | DOAJ lists accepted journals and publishes no list of rejected or removed ones. | A host that serves one DOAJ journal is rated for all its pages. DOAJ cannot lower a journal. |
| **EUvsDisinfo is imported from a file you compile** | The site has no bulk export and its firewall refuses scripted access to the case search. The importer does not try to get around that. | Someone has to produce the list of outlets. |
| **Lists are imported by hand and replace one list at a time** | Wikipedia and DOAJ change slowly, and a bad download must not erase good data. | The lists get stale until re-imported. A download that fails part-way aborts, and a list under half the stored size needs `--force`. |

## Research modes

| Choice | Why | Cost |
|---|---|---|
| **Cache queries and search results, not assessments or verdicts** | Search and planning are the slow, repeatable part, and their output (a list of public URLs) is then checked by the normal pipeline. Reusing a verdict on similarity could return the wrong answer, since "X is true" and "X is false" embed close together. | The assessor, debate and judge cost the same in both modes. |
| **Number guard** | Embeddings are close for texts differing in one year or figure, but those change what a good query is. | A reworded claim with a different formatting of the same number (such as "1,920") may miss. |
| **High thresholds (0.92, 0.93)** | A near-miss returns the wrong sources, which costs more than a cache miss. They are starting values, not tuned on real data. | Fewer hits. |
| **Plan cache holds no claim text** | Shared caches hold public data only; a claim may come from a private document. | Matching relies on the embedding and a digits signature. |
| **A deeper investigation skips the semantic caches** | Its purpose is to look again without shortcuts. | It still uses the exact-match search cache, so an identical query returns the saved result. |
| **API default `detailed`, form default `fast`** | Old clients and scripts keep today's behavior; people using the form get the faster path. | Two defaults to remember. |

## Known costs and future changes

- Every event updates one counter on the job document, and parallel claims compete for it. Firestore retries those transactions. At larger scale, number events per claim.
- The rate limiter lives in server memory, so it isn't shared between multiple instances.
- The scripted Gemini stand-in and the emulators can't reveal real-API problems such as response format, schema size or indexes. Run one supervised end-to-end test with real keys after any change to agent schemas or queries.
