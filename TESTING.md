# Testing

```bash
npm run test:unit          # Vitest, no services needed
npm run test:integration   # starts the Firestore, Auth and Storage emulators, then runs the integration tests
npm test                   # both
npm run typecheck
```

The integration tests need Java for the Firestore emulator. Gemini is replaced by a scripted test double, `tests/helpers/fakeGemini.ts`. It reads the real prompts the pipeline sends and answers using only the IDs and passages it was given, so the real validators run. Web pages are replaced through `vi.mock` of `fetchSource`. Fixtures and fakes live only in `tests/`, and `tests/unit/bundle.test.ts` builds the client and checks that none of them, and no key, reach the bundle.

| Area | Tests |
|---|---|
| Binary verdict | `unit/schemas`, `unit/validators` (Judge), `integration/pipeline`: only CORRECT and WRONG; basis consistency; limited evidence still gives a verdict; `research_failed` gives no verdict; `not_verifiable` claims never reach the Judge |
| Judge | Winner and verdict mapping; cited IDs must exist; decisive evidence must be `quote_verified` (rejection and repair); explanation stored |
| Agents | No minimum number of arguments; concession skips to the final step; challenges must reference real arguments; unsupported assertions flagged; quoted passages must be verbatim |
| Evidence layers | Snippets never labelled as quotes; 403, 429, 401 and 404 recorded as failures; HTTP 200 means retrieved only; duplicates of one original not counted as independent; SSRF refusal |
| Research budgets | Sufficiency check; deeper budget; stop reasons recorded |
| Debate order | Prompts contain the persisted IDs from the previous step; fast mode runs 3 steps and full mode 5 |
| Concurrency and recovery | Lease exclusivity; capped retries with backoff; stalled-stage resume; output from a lost lease discarded; honest `paused` state |
| Topic lock | A wrong `claimId` is repaired once; a persistent mismatch fails the stage; the hash is stable under whitespace changes |
| Caching and privacy | A past result is offered with its original date; other users never see it |
| Security | Cross-user 404s; no self-assigned roles; admin bootstrap needs a verified email; teacher access limited to their classroom; Firestore rules; usage limits; Storage disabled shows a message |
| Documents | Text PDF, scanned PDF (OCR), DOCX, TXT, image, encrypted, corrupted, unsupported and mismatched files, and unreadable pages |
| Audit wording | Fixed labels; no "fake", "invented" or AI-authorship claims; every passage verbatim; each check performed is recorded |
| Animation | Events are ordered and unique; each `debate_message` event matches its stored message; refresh in the browser shows the same result; sprites stay on the grid with 2 to 4 frames per state |
| End to end | `integration/ui.e2e`: in a real browser, register, submit text, confirm, run the investigation, see the result, refresh and see it again; `integration/pipeline` covers the same flow through the API |

## What the tests cannot cover

The real Gemini API, real Google Search grounding, and real websites are not exercised, because this environment has no Gemini key or Firebase project. Run a supervised verification with real keys before releasing.
