# Deployment

## Google AI Studio (full-stack runtime) or any Node host

1. **Enable Firebase for the project.** Turn on Authentication: Email/Password, and optionally Google. Create a Cloud Firestore database and enable Firebase Storage.
2. **Add the server Secrets.** These are `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_STORAGE_BUCKET` and `BOOTSTRAP_ADMIN_EMAILS`. On Google Cloud, `FIREBASE_PROJECT_ID` with default credentials works instead of the service-account JSON. Never prefix a secret with `VITE_`.
3. **Add the public web config.** These are the `VITE_FIREBASE_*` values. They are read at build time.
4. **Deploy the rules and indexes:**
   ```bash
   npx firebase deploy --only firestore:rules,firestore:indexes,storage --project <project-id>
   ```
5. **Build and start:**
   ```bash
   npm ci
   npm run build
   npm start          # serves /api and the built SPA from dist/ on $PORT
   ```
6. **Bootstrap the first administrator.** Sign in with an email listed in `BOOTSTRAP_ADMIN_EMAILS`. The email must be verified. From then on, administrators grant teacher and admin roles in **Administration → Users**.
7. **Check the setup.** Open **Settings → Server setup**: all three services should read "configured". Then run a short real verification and review the research log.

## Optional settings

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_MODEL_FAST` | `gemini-3.8-flash` | Extraction, research and debate model |
| `GEMINI_MODEL_JUDGE` | `gemini-3.1-pro-preview` | Judge model |
| `CLAIM_CONCURRENCY` | 3 | Stages run in parallel per advance call |
| `MAX_CLAIMS_PER_SUBMISSION` | 5 | Claims that can be selected per submission |
| `LIMIT_VERIFICATIONS_PER_DAY` | 20 | Per-user daily limit |
| `LIMIT_UPLOADS_PER_DAY` | 10 | Per-user daily limit |
| `LIMIT_MAX_FILE_MB` | 15 | Upload size limit |
| `LIMIT_MAX_PAGES` | 40 | Document page limit |
| `LIMIT_MAX_OCR_PAGES` | 15 | OCR page limit |
| `LIMIT_REQUESTS_PER_MINUTE` | 120 | Per-user request limit |
| `ALLOWED_ORIGINS` | none | Extra CORS origins. The API is same-origin by default. |
| `PORT` | 3000 | Server port |

## Cost

The app is designed to stay within free tiers where they exist, but **a $0 operating cost is not guaranteed**. Gemini calls, Google Search grounding, Firestore reads and writes, Storage and hosting may exceed free limits and need billing.

The app never enables billing or paid services itself. Costs are limited by the daily per-user limits, the research budgets, and the capped retries and AI calls per stage. Calls per stage are recorded in `stageRuns.aiCalls`, and totals per job in `verificationJobs.aiCalls`.

When the Gemini quota runs out, the user sees "The Gemini quota is exhausted. Existing data is preserved; try again later." The stage retries later.
