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
| `SEMANTIC_QUERY_SIMILARITY` | 0.92 | Fast mode: planned query this close to a saved one reuses its search results |
| `SEMANTIC_PLAN_SIMILARITY` | 0.93 | Fast mode: claim this close to an earlier one reuses its planned queries |
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
   The same file adds vector indexes for `searchCache` and `planCache` (filtered by `language`), used by fast mode. Searches saved before this change have no embedding and are never matched semantically.
2. Optional: index public pages the app already cached: `npm run kb:backfill -- --dry-run`, then without `--dry-run`. It reads only `pageCache` and only pages cached as stable.
3. Optional: seed Wikipedia articles you choose: `npm run kb:seed -- titles.txt --dry-run`, then without `--dry-run`. One `lang:Title` per line (`hy`, `ru`, `en`). Pick the topics your classes cover; the full Wikipedias are too large for this index.
4. Rough size: a page is about 10 to 75 passages. 100,000 passages take roughly 400 MB in Firestore and about 25 million embedding tokens once. Each investigation adds one embedding call per claim and one per newly fetched page. The vector query reads up to 30 documents per scope.

## Credibility database setup

The built-in rules need no setup. The imported lists are optional and are written to the `sourceCredibility` collection by hand-run scripts. Set `CREDIBILITY_IMPORT_CONTACT` to a URL or address where the sites can reach you; it is added to the User-Agent, as Wikimedia asks. Each command takes `--dry-run` to show what it would write.

1. `npm run credibility:import -- wikipedia`: the Wikipedia perennial sources list (the main page and its 8 subpages, fetched slowly because Wikimedia rate-limits; allow a few minutes). About 500 host records.
2. `npm run credibility:import -- doaj`: the Directory of Open Access Journals through its public API, about 24,000 journals at 50 per page, so roughly 480 requests (allow around 10 minutes). Use `--max-pages 3` to try it first, and add `--dry-run` so it writes nothing.
3. `npm run credibility:import -- euvsdisinfo outlets.txt`: EUvsDisinfo has no bulk export or API, so this reads a file you compile from the database: one outlet per line, as a domain, a URL, or `Name,url`. A CSV with one case per row works too, and repeated hosts are counted. Check the most frequent hosts the script prints before writing.
4. `npm run credibility:check -- facebook.com https://mess.gov.am/x journal.anau.am` prints what the pipeline will do with a site. Add `--offline` to use only the built-in rules.

A failed or partial download aborts without writing. If a new list is under half the size of the stored one, the script stops and asks for `--force`. Re-import every few months. Results already stored are not recalculated; the new ratings apply to investigations that run afterwards.

## Cost

The app is designed to stay within free tiers where they exist, but **a $0 operating cost is not guaranteed**. Gemini calls, Google Search grounding, Firestore reads and writes, Storage and hosting may exceed free limits and need billing.

The app never enables billing or paid services itself. Costs are limited by the daily per-user limits, the research budgets, and the capped retries and AI calls per stage. Calls per stage are recorded in `stageRuns.aiCalls`, and totals per job in `verificationJobs.aiCalls`.

When the Gemini quota runs out, the user sees "The Gemini quota is exhausted. Existing data is preserved; try again later." The stage retries later.
