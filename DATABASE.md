# Database (Cloud Firestore)

All writes go through the server. Every user-owned record carries a `userId`. Growing histories, such as events, messages, evidence and logs, are separate documents or subcollections, never arrays inside a document. Times used for logic are stored in milliseconds (`*Ms`); audit timestamps use `serverTimestamp()`.

## Phase 1

| Collection | Key fields |
|---|---|
| `users/{uid}` | `uid`, `email`, `displayName`, `role` (`student`, `teacher` or `admin`; server-controlled), `preferredLanguage`, `gradeLevel`, `accountStatus`, `usage {day, verifications, uploads}`, timestamps |
| `submissions/{id}` | `userId`, `originalText`, `subject`, `language`, `sourceType`, `fileId`, `classroomId`, `assignmentId`, `status`, `currentJobId`. The ID is a hash of the user and the idempotency key. |
| `verificationJobs/{jobId}` | `userId`, `submissionId`, `status`, `currentStage`, `supersededBy`, `supersedes`, `deep`, `outputLanguage`, `gradeLevel`, `confirmedAt`, `eventSeq`, `lastActivityAt`, `startedAtMs`, `completedAtMs`, `errorDetails`, `claimSummaries` (bounded by the claim limit), `aiCalls` |
| ↳ `stageRuns/{stageKey}` | `status` (`pending`, `leased`, `completed`, `failed` or `skipped`), `leaseOwner`, `leaseExpiresAt`, `attempts`, `nextRetryAt`, `startedAtMs`, `completedAtMs`, `durationMs`, `aiCalls`, `errorCode`, `errorMessage`, `outputRef` |
| ↳ `events/{seq}` | `seq`, `type`, `stageKey`, `claimId`, `agentType`, `ref {collection, id}`, `groupId`, `summary`, `data`, `createdAtMs` |
| `claims/{claimId}` | `jobId`, `submissionId`, `originalText`, `normalizedText`, `context`, `subject`, `language`, `status` (`pending_confirmation`, `confirmed` or `not_verifiable`), `selected`, `complexityClass`, `timeSensitivity`, `debateId`, `debateMode`, `topicHash`, `outcome` (`pending`, `judged`, `research_failed`, `failed` or `skipped`), `verdict`, `failure`, `cacheKey` |
| `researchLog/{id}` | `claimId`, `agentType`, `action` (`search_query`, `fetch_page`, `read_pdf`, `quote_verified`, `retrieval_failed`, `source_rejected`, `research_stopped` or `kb_lookup`), `queryOrUrl`, `resultSummary`, `failureReason`, `timestampMs` |
| `evidence/{claimId}_{E#}` | the PART 9.5 fields plus `domain`, `snippet`, `conditionsMatch`, `conditionsNote`, `countsAsIndependent`, `trustedSource`, `sourcePolicy` (see Source credibility) |
| `agentAnalyses/{id}` | triage output and research state (plan, queries, leads, budget used, stop reason) |
| `debates/{claimId}_debate` | `mode`, `status`, `topic` (the full stored `DebateTopic`, including `topicHash`), `language` (pinned at creation; every round, the Judge and the Pedagogue write in it), stances |
| `debateMessages/{id}` | `debateId`, `claimId`, `agentType`, `roundNumber`, `stepName`, `messageType`, `argumentId`, `referencedArgumentIds`, `referencedEvidenceIds`, `content`, `details`, `unsupportedAssertion`, `order` |
| `argumentChallenges/{debateId}_{C#}` | `challengedArgumentId`, `challengingArgumentId`, `challengeType`, `explanation`, `response`, `outcome` |
| `judgeDecisions/{claimId}_judge` | `winner`, `verdict` (`CORRECT` or `WRONG` only), `verdictBasis`, `reasoning`, `whatWasEstablished`, `whatWasNotEstablished`, `decisiveEvidenceIds`, accepted and rejected arguments, `evidenceStrength`, `limitations`, `believability`, `positionOrder` |
| `verificationResults/{claimId}` | `verdict`, `verdictBasis`, `summary`, `evidenceStrength`, `sourceCounts`, `cacheKey`, `timeSensitivity`, `completedAtMs` |
| `searchCache`, `pageCache` | public web data only, with `expiresAtMs`; `searchCache` also stores an `embedding` (vector) used by fast research mode |
| `kbPublic/{sourceId}_{n}` | public passage: `sourceId`, `url`, `title`, `kind` (`web` or `wikipedia`), `chunkIndex`, `page`, `text`, `fetchedAtMs`, `embedding` (vector, 768) |
| `kbSources/{sourceId}` | one row per indexed public page: `url`, `contentHash`, `chunkCount`, `fetchedAtMs` |
| `kbClassroom/{materialId}_{n}` | teacher-material passage: `classroomId`, `materialId`, `teacherId`, `fileName`, `chunkIndex`, `page`, `text`, `fetchedAtMs`, `embedding` (vector, 768). Always queried with a `classroomId` filter. |
| `classroomMaterials/{materialId}` | `classroomId`, `teacherId`, `fileName`, `status` (`indexing` or `ready`), `chunkCount`, `sizeBytes`, `createdAtMs` |
| `planCache/{hash}` | fast research mode: `language`, `numbers` (digits in the claim), `queries`, `createdAtMs`, `embedding` (vector, 768). No claim text. |
| `auditLogs` | `userId`, `eventType`, `resourceId`, `metadata` (no content), `timestamp` |

## Phase 2

| Collection | Key fields |
|---|---|
| `submissionFiles/{fileId}` | `userId`, `fileName`, `mimeType`, `sizeBytes`, `storagePath` (`users/{uid}/files/{fileId}/original`), `status`, `pageCount`, `warnings` |
| `extractionPages/{fileId}_p#` | `pageNumber`, `status` (`extracted`, `ocr`, `failed` or `skipped`), `method`, `warning`, `charCount`, `text` |
| `qualityFindings/{jobId}_f#` | `kind`, `label`, `passage`, `passageB`, `explanation`, `severity`, `check {performed, result}`, `offerAsClaim`, `submissionId`, `classroomId` |

## Phase 3

| Collection | Key fields |
|---|---|
| `educationalExplanations/{claimId}` | `explanation`, `keyLesson`, `fallacies`, `sourceEvaluationTips`, `language`, `gradeLevel` |
| `learningExercises/{claimId}_x#` | `question`, `options`, `correctIndex` (hidden until answered), `explanation`, `evidenceIds`, `attempt` |
| `profiles/{uid}` | `exercisesAnswered`, `exercisesCorrect`, `lastActivityAtMs` |
| `classrooms/{id}` | `name`, `gradeLevel`, `teacherId`, `inviteCode` |
| `classroomMembers/{classroomId}_{uid}` | `classroomId`, `userId`, `displayName`, `joinedAtMs` |
| `assignments/{id}` | `classroomId`, `teacherId`, `title`, `instructions`, `dueAtMs` |

## Phase 4

| Collection | Key fields |
|---|---|
| `trustedSources/{id}` | `name`, `url`, `host`, `subjects`, `gradeLevels`, `reliabilityDescription`, `verificationStatus` |
| `notifications/{id}` | `userId`, `type`, `jobId`, `status`, `read` |
| `verificationReceipts/{id}` | `userId`, `claimId`, `hash` (SHA-256 of the canonical result), `verdict`, `topicStatement` |

Indexes are listed in `firestore.indexes.json`. Deploy them with `firebase deploy --only firestore:indexes`.

## Source credibility

A first opinion about each website, decided in code. Server-only: Firestore rules deny all client access (the default rule), and only the import scripts write it.

| Collection | Key fields |
|---|---|
| `sourceCredibility/{origin}__{host}` | `host`, `origin` (`wikipedia_rsp`, `doaj` or `euvsdisinfo`), `name`, `tier` (`high`, `medium`, `low`), `use` (`evidence` or `context_only`), `category`, `attribution`, `note`, `sourceUrl`, `importedAtMs` |

One document per list and host, so re-importing one list never touches another. The built-in rules (social networks, blogs, file sharing, Wikipedia, `.gov`, `*.gov.am`, `escs.am`, `.edu`, `.ac.*`, `lib.armedu.am`, `*.sci.am` and two journals) are in `src/server/research/credibility/rules.ts`, not in the database, so they are reviewed like code.

How a host is resolved (`resolve.ts`):

1. An explicit built-in rule wins. One exception: the journal rules yield to a DOAJ record for the same host.
2. Otherwise the stored records for the host and its parent domains; the most specific host wins, and on a tie the more cautious record wins (lower tier, then context only).
3. Otherwise a class rule (`.gov`, `.edu`, `.ac.*`). These are suffix guesses, so any stored record beats them (`academia.edu` is rated by Wikipedia's list, not by `.edu`).
4. Otherwise the site is unknown and is capped at medium.

The result is stored on each evidence record as `sourcePolicy` (`tier`, `use`, `category`, `attribution`, `origin`, `rule`, `note`). It is missing on records made before this feature and for classroom materials. Claims gain `attributionClaim` (see AI_AGENTS.md).

| Meaning | Rule |
|---|---|
| `tier` | A ceiling. The Researcher's own credibility rating can only lower it. An unlisted site is capped at medium. |
| `use: context_only` | The source can be read and quoted but never counts as an independent source, never makes the evidence sufficient, never supports an argument on its own, and can never be decisive evidence for the Judge. |
| `stateOwned` | A marker, never a rating: the outlet is known to be owned, run or funded by a state. It comes from a short built-in list (`STATE_OWNED_MEDIA` in `rules.ts`) and from Wikipedia's list wherever a summary says so. It is added to whatever policy the site got and does not change the tier; a site with no policy that is on the built-in list gets a medium policy only to carry the marker. The interface shows it under the source title, and the agents are told to weigh the owner's interests. Missing means "not known to be", never "independent". |
| `attribution` | A context-only source that speaks for its owner (an account, a blog, a disinformation outlet) may be evidence for a claim about **who said what**, and only that it was said. File-sharing sites and Wikipedia never have it. |
