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
| `evidence/{claimId}_{E#}` | the PART 9.5 fields plus `domain`, `snippet`, `conditionsMatch`, `conditionsNote`, `countsAsIndependent`, `trustedSource` |
| `agentAnalyses/{id}` | triage output and research state (plan, queries, leads, budget used, stop reason) |
| `debates/{claimId}_debate` | `mode`, `status`, `topic` (the full stored `DebateTopic`, including `topicHash`), stances |
| `debateMessages/{id}` | `debateId`, `claimId`, `agentType`, `roundNumber`, `stepName`, `messageType`, `argumentId`, `referencedArgumentIds`, `referencedEvidenceIds`, `content`, `details`, `unsupportedAssertion`, `order` |
| `argumentChallenges/{debateId}_{C#}` | `challengedArgumentId`, `challengingArgumentId`, `challengeType`, `explanation`, `response`, `outcome` |
| `judgeDecisions/{claimId}_judge` | `winner`, `verdict` (`CORRECT` or `WRONG` only), `verdictBasis`, `reasoning`, `whatWasEstablished`, `whatWasNotEstablished`, `decisiveEvidenceIds`, accepted and rejected arguments, `evidenceStrength`, `limitations`, `believability`, `positionOrder` |
| `verificationResults/{claimId}` | `verdict`, `verdictBasis`, `summary`, `evidenceStrength`, `sourceCounts`, `cacheKey`, `timeSensitivity`, `completedAtMs` |
| `searchCache`, `pageCache` | public web data only, with `expiresAtMs` |
| `kbPublic/{sourceId}_{n}` | public passage: `sourceId`, `url`, `title`, `kind` (`web` or `wikipedia`), `chunkIndex`, `page`, `text`, `fetchedAtMs`, `embedding` (vector, 768) |
| `kbSources/{sourceId}` | one row per indexed public page: `url`, `contentHash`, `chunkCount`, `fetchedAtMs` |
| `kbClassroom/{materialId}_{n}` | teacher-material passage: `classroomId`, `materialId`, `teacherId`, `fileName`, `chunkIndex`, `page`, `text`, `fetchedAtMs`, `embedding` (vector, 768). Always queried with a `classroomId` filter. |
| `classroomMaterials/{materialId}` | `classroomId`, `teacherId`, `fileName`, `status` (`indexing` or `ready`), `chunkCount`, `sizeBytes`, `createdAtMs` |
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
