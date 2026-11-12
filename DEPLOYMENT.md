# Deployment

## Without installing Node.js: Render

`render.yaml` is a Render blueprint. Render builds and runs the app from GitHub.

1. Create a Firebase project. Enable Email/Password sign-in and Cloud Firestore. Storage is optional: without it, document upload stays disabled and pasted text still works. Then:
   - copy the web app config (the `VITE_FIREBASE_*` values);
   - download a service-account key under Project settings → Service accounts.
2. Get a Gemini API key from Google AI Studio.
3. In Render, choose New → Blueprint and select this repository. Fill in the values marked `sync: false` and deploy. The service-account JSON goes into `FIREBASE_SERVICE_ACCOUNT_JSON` as one line.
4. In Firebase Authentication → Settings → Authorized domains, add the `*.onrender.com` address Render gives you.
5. Deploy the rules and indexes once: `npx firebase deploy --only firestore:rules,firestore:indexes,storage`. If you have no Node.js, paste `firestore.rules` into the Firebase console Rules tab instead. Pages still work before the indexes exist: a query that lacks its index falls back to a slower in-memory sort. The server log then shows one `Firestore index missing` warning per query, with a `createIndexLink`. Open each link once to create the index.

The free Render plan sleeps after about 15 minutes without traffic, so the first request after that is slow. An open investigation simply resumes, as described in ARCHITECTURE.md.

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
| `GEMINI_MODEL_EMBED` | `gemini-embedding-001` | Knowledge-base embeddings. Output is cut to 768 dimensions; changing the model means re-indexing. |
| `KB_STRONG_SIMILARITY` | 0.72 | Cosine similarity at which a stored source counts towards skipping the first web search |
| `KB_MIN_SIMILARITY` | 0.62 | Passages below this are ignored |
| `KB_PUBLIC_MAX_AGE_DAYS` | 90 | Stored public pages older than this are not used |
| `LIMIT_MATERIALS_PER_CLASSROOM` | 50 | Teacher materials per classroom |
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

## Knowledge base setup

1. Deploy the indexes (`firestore:indexes` above). They include two **vector indexes** (`kbPublic`, and `kbClassroom` filtered by `classroomId`). Vector indexes build in the background and can take several minutes. Until they exist, vector queries fail, the server logs `kb.retrieve_failed`, and research falls back to the web search.
2. Optional: index public pages the app already cached: `npm run kb:backfill -- --dry-run`, then without `--dry-run`. It reads only `pageCache` and only pages cached as stable.
3. Optional: seed Wikipedia articles you choose: `npm run kb:seed -- titles.txt --dry-run`, then without `--dry-run`. One `lang:Title` per line (`hy`, `ru`, `en`). Pick the topics your classes cover; the full Wikipedias are too large for this index.
4. Rough size: a page is about 10 to 75 passages. 100,000 passages take roughly 400 MB in Firestore and about 25 million embedding tokens once. Each investigation adds one embedding call per claim and one per newly fetched page. The vector query reads up to 30 documents per scope.

## Cost

The app is designed to stay within free tiers where they exist, but **a $0 operating cost is not guaranteed**. Gemini calls, Google Search grounding, Firestore reads and writes, Storage and hosting may exceed free limits and need billing.

The app never enables billing or paid services itself. Costs are limited by the daily per-user limits, the research budgets, and the capped retries and AI calls per stage. Calls per stage are recorded in `stageRuns.aiCalls`, and totals per job in `verificationJobs.aiCalls`.

When the Gemini quota runs out, the user sees "The Gemini quota is exhausted. Existing data is preserved; try again later." The stage retries later.
