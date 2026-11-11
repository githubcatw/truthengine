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

- **No durable background worker.** The investigation advances only while the Live Investigation page is open. If the page is closed, the job shows as `paused` and resumes when reopened. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **No end-to-end run with the real Gemini API yet.** Everything was built and tested in a sandbox without a Gemini key or a Firebase project. Gemini is replaced by a scripted test double that lives only in `tests/`, and the Firebase emulators stand in for Firestore, Auth and Storage. The first run with real keys should be watched closely: grounding results, prompt behaviour and model output lengths are not yet verified against the live API.
- **The Judge model is a preview.** The defaults are `gemini-3.8-flash` (stable) and `gemini-3.1-pro-preview` for the Judge. No stable Pro text model was published at the time of writing. Override with `GEMINI_MODEL_FAST` and `GEMINI_MODEL_JUDGE`.
- **Some sites block automated retrieval.** Their sources are recorded as `retrieval_failed` with the reason, never as verified.
- **Processing times are unmeasured.** No times against the real API exist yet. The admin Performance view shows the real recorded duration of every stage once the app runs.
- **No QR codes in PDF reports.** The app has no public verification page, so a QR code would point to a login-only page.
- **No AI-authorship detection.** The citation audit deliberately does not try to detect AI-written text.
