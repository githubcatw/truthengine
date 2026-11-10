# TruthEngine Classroom

"Don't Just Trust AI. Verify It." A multi-agent claim verification app for Armenian students and teachers.

## Status

Part 0 (the foundation) is in place:

- Stack scaffold: React, TypeScript, Tailwind, Framer Motion and Lucide on the client; a Node/Express REST API on the server; Gemini via `@google/genai`, server-side only; Firebase Admin; Zod; Vitest.
- One shared Zod schema set in `src/shared/schemas.ts`, covering the binary verdict, the three validation layers, topic lock and the API error shape.
- Server-only Gemini client (`src/server/ai/gemini.ts`). If the key is missing or invalid, it returns a clear setup error and never fakes results.
- Structured output with exactly one repair retry (`src/server/ai/structured.ts`).
- Zero-hallucination checks (`src/server/validation/contract.ts`): evidence ID validation, URL origin checks, verbatim excerpt verification, `unsupported_assertion` flagging, fail-closed on zero usable evidence, and topic-lock hashing.
- Untrusted-content wrapping for documents and web pages (`src/server/ai/untrusted.ts`).
- A secret-redacting logger and safe, consistent error responses.
- `GET /api/setup-status`, shown in the UI. It reports which services are configured and never returns any credential.

Not built yet: authentication, verification, and the rest of the features in the specification. These come in later parts.

## Setup

1. `npm install`
2. Configure the server Secrets (see `.env.example`):
   - `GEMINI_API_KEY`: required for any verification.
   - `FIREBASE_SERVICE_ACCOUNT_JSON`, or `FIREBASE_PROJECT_ID` with default credentials: required for Auth and Firestore.
   - `FIREBASE_STORAGE_BUCKET`: required for document upload. Without it, upload stays disabled and pasted text still works.
   - The `VITE_FIREBASE_*` values are the public Firebase web config.
3. Run `npm run dev`. The client runs on port 5173 and the API on port 3000.

Model names (`gemini-2.5-flash` and `gemini-2.5-pro` by default) are in `src/server/config.ts`. Verify that they exist for your key, or override them with `GEMINI_MODEL_FAST` and `GEMINI_MODEL_JUDGE`.

## Tests

`npm test` runs the unit tests with a mocked Gemini client, plus a bundle test. The bundle test builds the client and checks that no fixtures, server code, or key reached it.
