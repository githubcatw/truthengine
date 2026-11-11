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

## Known costs and future changes

- Every event updates one counter on the job document, and parallel claims compete for it. Firestore retries those transactions. At larger scale, number events per claim.
- The rate limiter lives in server memory, so it isn't shared between multiple instances.
- The scripted Gemini stand-in and the emulators can't reveal real-API problems such as response format, schema size or indexes. Run one supervised end-to-end test with real keys after any change to agent schemas or queries.
