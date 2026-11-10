# REST API

Every route except `GET /api/setup-status` requires `Authorization: Bearer <Firebase ID token>`.

Errors always have the shape `{ "error": { "code": "...", "message": "..." } }`. The `message` is safe to show to the user. A record that does not exist and a record belonging to someone else both return `404 NOT_FOUND`.

The only verdict values are `"CORRECT"` and `"WRONG"`, or `null` when no verdict exists.

| Method and path | Purpose |
|---|---|
| `GET /api/setup-status` | Whether Gemini, Firebase and Storage are configured (booleans and messages only) |
| `GET /api/me` · `PATCH /api/me` | Profile. Only `displayName`, `preferredLanguage` and `gradeLevel` can be changed; any other field is rejected. |
| `POST /api/verifications` | Create a submission and job: `{text, subject?, language?, idempotencyKey, fileId?, assignmentId?}` |
| `GET /api/verifications?cursor=` | History, paginated |
| `GET /api/verifications/:jobId` | Job, claims, stage runs and past matching results. Teachers of the job's classroom get read-only access. |
| `POST /api/verifications/:jobId/advance` | Run the next ready stages. Owner only. |
| `POST /api/verifications/:jobId/confirm` | `{claims: [{claimId, selected, normalizedText?}]}` |
| `POST /api/verifications/:jobId/cancel` | Cancel the job |
| `POST /api/verifications/:jobId/retry` | New job, optionally `{claimIds}` |
| `POST /api/verifications/:jobId/claims/:claimId/deeper` | New job with the larger budget and full debate mode |
| `POST /api/verifications/:jobId/claims/:claimId/topic` | `{normalizedText}`. Supersedes the running job. |
| `GET /api/verifications/:jobId/events?after=&limit=` | Persisted events, paginated |
| `GET /api/verifications/:jobId/findings` | Quality and citation audit findings |
| `GET /api/claims/:claimId` | Full report: claim, debate topic, evidence, messages, challenges, decision, result, lesson, exercises |
| `GET /api/claims/:claimId/research-log` | Research log, paginated |
| `POST /api/files` | Upload as a raw body with `Content-Type` and `X-File-Name` headers. Returns the extracted text and per-page status. Returns 503 when Storage is not configured. |
| `GET /api/files/:id` · `GET /api/files/:id/download` | Metadata and pages; download is owner only |
| `GET /api/exercises` · `POST /api/exercises/:id/answer` | The user's exercises; `{selectedIndex}` |
| `GET /api/learning/progress` | Exercise totals |
| `GET/POST /api/classrooms` | List classrooms; create one (teacher or admin) |
| `POST /api/classrooms/join` | `{inviteCode}` |
| `GET /api/classrooms/:id` | Classroom, assignments, and members (members for the teacher only) |
| `POST /api/classrooms/:id/assignments` | Create an assignment (teacher) |
| `DELETE /api/classrooms/:id/members/:uid` | Remove a member (teacher) |
| `GET /api/classrooms/:id/submissions` · `/insights` | Submissions to this classroom, misconceptions and progress (teacher) |
| `GET /api/assignments/:id` | Assignment, plus the student's own submissions to it |
| `GET /api/sources` · `POST/PUT/DELETE /api/sources/:id` | Trusted-sources registry; changes are admin only |
| `POST /api/receipts` · `GET /api/receipts` · `GET /api/receipts/:id/verify` | Integrity receipts |
| `GET /api/notifications` · `GET /api/notifications/unread-count` · `POST /api/notifications/:id/read` | Notifications |
| `GET /api/reports/:claimId.pdf` | PDF report |
| `GET /api/admin/users` · `PATCH /api/admin/users/:uid/role` · `PATCH /api/admin/users/:uid/status` | User administration |
| `GET /api/admin/performance` · `/activity` · `/settings` | Recorded stage durations, the audit log, and the configuration (read only, no secrets) |

## Error codes

`GEMINI_NOT_CONFIGURED`, `GEMINI_INVALID_KEY`, `GEMINI_QUOTA_EXHAUSTED`, `FIREBASE_NOT_CONFIGURED`, `STORAGE_NOT_CONFIGURED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_INPUT`, `CONFLICT`, `RATE_LIMITED`, `USAGE_LIMIT`, `AI_OUTPUT_INVALID`, `RESEARCH_FAILED`, `UNSUPPORTED_FILE`, `ENCRYPTED_FILE`, `CORRUPTED_FILE`, `INTERNAL`.
