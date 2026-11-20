# TruthEngine Classroom

**"Don't Just Trust AI. Verify It."**

TruthEngine Classroom helps Armenian students and teachers check claims. A student pastes text or uploads a document and confirms which claims to check. Agents then retrieve real web evidence, a Defender and a Prosecutor debate each claim, and an independent Judge rules CORRECT or WRONG with its reasons. A Pedagogue turns the result into a lesson. The whole process plays as a live pixel-art animation built only from stored events.

The interface is available in Armenian, English and Russian.

## What is built

All four phases of the specification are implemented, tested against the Firebase emulators, and documented.

| Phase | Features |
|---|---|
| 1 | Firebase Auth, server-controlled roles, server-side authorization and Firestore rules. Text submission, claim extraction and confirmation, and triage. Real research checked in three layers: provenance, source quality and claim support. Fast and full debate, the binary-verdict Judge, the resumable stage runner with leases, and results, history, settings and profile. |
| 2 | Document upload to Firebase Storage. Extraction for PDF (native text and OCR), DOCX, TXT and images. The Document Quality and Citation Audit. Persisted events, the pixel agents, the live animation, the argument map and replay. |
| 3 | The Pedagogue, exercises, the Learning Center, student progress, classrooms with invitations, assignments, teacher review and misconception analysis. |
| 4 | Trusted-sources registry, PDF reports with embedded Armenian fonts, notifications, integrity receipts, the admin view (users and roles, performance, activity, settings) and the audit log. |

**Source credibility.** A database and fixed rules, not the AI, decide a first opinion about each website. Social networks, blogs and file-sharing sites are low credibility and context only; Wikipedia is medium and context only; `.gov`, `*.gov.am` and `escs.am` are high credibility government sites; `.edu`, `.ac.*`, `lib.armedu.am` and `*.sci.am` are high credibility education sources; two Armenian journals are high credibility. Wikipedia's perennial sources list, DOAJ and EUvsDisinfo can be imported on top. Context-only sources are shown but can never decide a verdict, except for claims about who said what. The AI's own rating can only lower the tier. See [DATABASE.md](DATABASE.md#source-credibility) and [DEPLOYMENT.md](DEPLOYMENT.md#credibility-database-setup).

What still needs configuration, and the honest limitations, are listed under [Known limitations](#known-limitations).

## Quick start

```bash
npm install
cp .env.example .env      # fill in the values (see below)
npm run dev               # client on :5173, API on :3000
```

The server needs these Secrets. In Google AI Studio, put them in Secrets, not in the code:

| Variable | Needed for |
|---|---|
| `GEMINI_API_KEY` | Every AI step. If it is missing, the app shows a setup message and never fakes results. |
| `FIREBASE_SERVICE_ACCOUNT_JSON`, or `FIREBASE_PROJECT_ID` with default credentials | Auth token checks and Firestore. |
| `FIREBASE_STORAGE_BUCKET` | Document upload. Without it, upload is disabled with a message; pasted text still works. |
| `BOOTSTRAP_ADMIN_EMAILS` | Comma-separated emails that become administrators on their first sign-in with a verified email. |

The browser needs the public web config: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET` and `VITE_FIREBASE_APP_ID`. Set `VITE_FIREBASE_GOOGLE_SIGNIN=true` only after enabling Google sign-in in Firebase Auth.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full setup, including the rules and indexes.

## Documentation

- [DECISIONS.md](DECISIONS.md): why each framework and design choice was made, and what it costs.
- [ARCHITECTURE.md](ARCHITECTURE.md): the execution model, the stage graph, leases, pause behaviour and caching.
- [DATABASE.md](DATABASE.md): collections, fields, ownership and indexes.
- [API.md](API.md): REST routes and the error format.
- [AI_AGENTS.md](AI_AGENTS.md): each agent's inputs, outputs, validators and the zero-hallucination contract.
- [DEPLOYMENT.md](DEPLOYMENT.md): Firebase, AI Studio and cost controls.
- [TESTING.md](TESTING.md): how to run the tests and what they cover.

## Known limitations

- **The credibility database is a first opinion, not a verdict.** The lists rate outlets, not statements: a reliable outlet can print a wrong claim. Wikipedia's perennial sources list is an English Wikipedia editors' consensus and covers few Armenian outlets. DOAJ is applied per host, so a host that serves one DOAJ journal is rated for all its pages, and DOAJ can confirm a journal but never lower it, because it publishes no list of rejected journals. EUvsDisinfo has no bulk export and its site refuses scripted access, so its importer reads a list of outlets you compile. A university domain rule cannot tell an institutional page from a student's personal page, and many Armenian universities are not under `.edu.am` or `.ac.*` and are treated as unlisted (medium) until added to `src/server/research/credibility/rules.ts`. Unlisted sites are capped at medium.
- **The "who said what" flag is a model judgement.** The claim extractor sets it. A wrong flag can only let an owner's own account show that something was said, never that it is true. It has not been tested with a real model.
- **Knowledge base is unmeasured.** Retrieval thresholds (`KB_MIN_SIMILARITY`, `KB_STRONG_SIMILARITY`) are starting values. Vector search and the real embedding model were not run in the sandbox: the Firestore emulator has no vector search, so tests rank in process with the same filters and a scripted embedding. Run a few real claims and look at the **Knowledge base** line in the research log before relying on it. Armenian, Russian and English interface strings for materials were written without native review.

- **No durable background worker.** The investigation advances only while the Live Investigation page is open. If the page is closed, the job shows as `paused` and resumes when reopened. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **Little real-API experience yet.** The automated tests replace Gemini with a scripted test double (only in `tests/`) and use the Firebase emulators. The deployment on Render is the first real run, and it already exposed three gaps the tests could not: the missing answer schema, Gemini's schema size limit and missing Firestore indexes. All three are fixed. Watch the first investigations closely.
- **The Judge model is a preview.** The defaults are `gemini-3.8-flash` (stable) and `gemini-3.1-pro-preview` for the Judge. No stable Pro text model was published at the time of writing. Override with `GEMINI_MODEL_FAST` and `GEMINI_MODEL_JUDGE`.
- **Some sites block automated retrieval.** Their sources are recorded as `retrieval_failed` with the reason, never as verified.
- **Processing times are not yet reported.** Real timings are recorded for every stage and logged as one `job finished` line per job (see [ARCHITECTURE.md](ARCHITECTURE.md#measured-timings)). Measured numbers will be added here once there are real runs to report.
- **No QR codes in PDF reports.** The app has no public verification page, so a QR code would point to a login-only page.
- **No AI-authorship detection.** The citation audit deliberately does not try to detect AI-written text.
