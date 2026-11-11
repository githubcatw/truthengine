// Job lifecycle: submission, claim confirmation, follow-up jobs (retry, deeper,
// topic edit → supersede), cancel, and the job view returned to clients.
import { FieldValue } from 'firebase-admin/firestore';
import { orderedQuery } from '../firestoreQuery';
import { TERMINAL_JOB_STATUSES, type Language, type Subject } from '../../shared/schemas';
import type { AuthedUser } from '../auth';
import { PIPELINE, USAGE_LIMITS } from '../config';
import { AppError } from '../errors';
import { db } from '../firebase';
import { claimCacheKey } from './handlers/extractClaims';
import { effectiveStatus, loadJobState } from './runner';
import { C, col, hashId, jobRef, newId, writeEventsInTx } from './store';
import { buildTopic, debateIdFor } from './topic';
import type { ClaimDoc, JobDoc } from './types';

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function auditLog(userId: string, eventType: string, resourceId: string, metadata: Record<string, unknown> = {}) {
  await col(C.auditLogs).add({ userId, eventType, resourceId, metadata, timestamp: FieldValue.serverTimestamp() });
}

function newJob(input: {
  jobId: string;
  submissionId: string;
  user: AuthedUser;
  sourceType: JobDoc['sourceType'];
  fileId: string | null;
  classroomId: string | null;
  assignmentId: string | null;
  deep: boolean;
  supersedes: string | null;
  prefilledClaims: boolean;
  outputLanguage: Language;
}): JobDoc {
  const now = Date.now();
  return {
    jobId: input.jobId,
    submissionId: input.submissionId,
    userId: input.user.uid,
    status: 'queued',
    currentStage: input.prefilledClaims ? 'triage' : 'extract_claims',
    supersededBy: null,
    supersedes: input.supersedes,
    deep: input.deep,
    outputLanguage: input.outputLanguage,
    gradeLevel: input.user.gradeLevel,
    sourceType: input.sourceType,
    fileId: input.fileId,
    classroomId: input.classroomId,
    assignmentId: input.assignmentId,
    prefilledClaims: input.prefilledClaims,
    confirmedAt: input.prefilledClaims ? now : null,
    eventSeq: 0,
    lastActivityAt: now,
    startedAtMs: now,
    completedAtMs: null,
    errorDetails: null,
    claimSummaries: [],
    aiCalls: 0,
  };
}

/** Enforces the per-user daily verification limit inside a transaction. */
async function consumeVerificationQuota(tx: FirebaseFirestore.Transaction, uid: string) {
  const ref = col(C.users).doc(uid);
  const snap = await tx.get(ref);
  const usage = (snap.get('usage') as { day: string; verifications: number; uploads: number } | undefined) ?? null;
  const day = today();
  const used = usage?.day === day ? usage.verifications : 0;
  if (used >= USAGE_LIMITS.verificationsPerDay) {
    throw new AppError('USAGE_LIMIT', `Daily limit of ${USAGE_LIMITS.verificationsPerDay} verifications reached. Your existing results are kept; try again tomorrow.`);
  }
  return () => tx.set(ref, { usage: { day, verifications: used + 1, uploads: usage?.day === day ? usage.uploads : 0 } }, { merge: true });
}

export interface CreateSubmissionInput {
  text: string;
  subject: Subject | null;
  language: Language | null;
  idempotencyKey: string;
  fileId: string | null;
  assignmentId: string | null;
}

export async function createSubmission(user: AuthedUser, input: CreateSubmissionInput) {
  const submissionId = hashId(user.uid, input.idempotencyKey);
  const jobId = `${submissionId}_j1`;
  let classroomId: string | null = null;
  if (input.assignmentId) {
    const a = await col(C.assignments).doc(input.assignmentId).get();
    if (!a.exists) throw new AppError('NOT_FOUND', 'Assignment not found.');
    classroomId = a.get('classroomId') as string;
    const member = await col(C.members).doc(`${classroomId}_${user.uid}`).get();
    if (!member.exists) throw new AppError('FORBIDDEN', 'You are not a member of this classroom.');
  }
  if (input.fileId) {
    const f = await col(C.files).doc(input.fileId).get();
    if (!f.exists || f.get('userId') !== user.uid) throw new AppError('NOT_FOUND', 'File not found.');
  }

  return db().runTransaction(async (tx) => {
    const subRef = col(C.submissions).doc(submissionId);
    const existing = await tx.get(subRef);
    // Duplicate-submission protection: the same idempotency key returns the same job.
    if (existing.exists) return { submissionId, jobId: existing.get('currentJobId') as string, duplicate: true };
    // Real per-page extraction results become the first events of a document job (PART 14.3).
    const pages = input.fileId ? (await tx.get(col(C.extractionPages).where('fileId', '==', input.fileId))).docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    const commitQuota = await consumeVerificationQuota(tx, user.uid);
    const job = newJob({
      jobId,
      submissionId,
      user,
      sourceType: input.fileId ? 'document' : 'text',
      fileId: input.fileId,
      classroomId,
      assignmentId: input.assignmentId,
      deep: false,
      supersedes: null,
      prefilledClaims: false,
      outputLanguage: user.preferredLanguage,
    });
    commitQuota();
    tx.set(subRef, {
      submissionId,
      userId: user.uid,
      originalText: input.text,
      subject: input.subject,
      language: input.language,
      sourceType: job.sourceType,
      fileId: input.fileId,
      classroomId,
      assignmentId: input.assignmentId,
      status: 'active',
      currentJobId: jobId,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(jobRef(jobId), { ...job, createdAt: FieldValue.serverTimestamp(), startedAt: FieldValue.serverTimestamp() });
    const pageEvents = (pages as Array<{ id: string; pageNumber: number; status: string; method: string; warning: string | null; charCount: number }>)
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((p) => ({
        type: 'extraction_page' as const,
        agentType: 'content_extractor',
        ref: { collection: 'extractionPages' as const, id: p.id },
        groupId: 'extraction',
        summary: `Page ${p.pageNumber}: ${p.status} (${p.method}, ${p.charCount} characters)${p.warning ? ` — ${p.warning}` : ''}`,
        data: { pageNumber: p.pageNumber, status: p.status },
      }));
    writeEventsInTx(tx, jobId, user.uid, 0, [{ type: 'job_status', summary: null, data: { status: 'queued' } }, ...pageEvents]);
    return { submissionId, jobId, duplicate: false };
  });
}

export interface ClaimSelection {
  claimId: string;
  selected: boolean;
  normalizedText?: string;
}

export async function confirmClaims(user: AuthedUser, jobId: string, selections: ClaimSelection[]) {
  const { job, claims, runs } = await loadJobState(jobId);
  if (job.userId !== user.uid) throw new AppError('NOT_FOUND', 'Not found.');
  if (TERMINAL_JOB_STATUSES.includes(job.status)) throw new AppError('CONFLICT', 'This investigation has ended.');
  if (job.confirmedAt) throw new AppError('CONFLICT', 'Claims were already confirmed for this investigation.');
  if (runs.get('extract_claims')?.status !== 'completed') throw new AppError('CONFLICT', 'Claims are still being extracted.');

  const byId = new Map(claims.map((c) => [c.claimId, c]));
  const chosen = selections.filter((s) => s.selected);
  if (!chosen.length) throw new AppError('INVALID_INPUT', 'Select at least one claim to verify.');
  if (chosen.length > PIPELINE.defaultMaxClaims) throw new AppError('INVALID_INPUT', `Select at most ${PIPELINE.defaultMaxClaims} claims.`);
  for (const s of selections) {
    const c = byId.get(s.claimId);
    if (!c) throw new AppError('INVALID_INPUT', 'Unknown claim.');
    if (s.selected && c.status === 'not_verifiable') throw new AppError('INVALID_INPUT', 'Opinions, predictions and value judgments cannot be verified as facts.');
  }

  await db().runTransaction(async (tx) => {
    const jobSnap = await tx.get(jobRef(jobId));
    const current = jobSnap.data() as JobDoc;
    if (current.confirmedAt) throw new AppError('CONFLICT', 'Claims were already confirmed for this investigation.');
    for (const c of claims) {
      if (c.status === 'not_verifiable') continue;
      const sel = selections.find((s) => s.claimId === c.claimId);
      if (sel?.selected) {
        const normalizedText = sel.normalizedText?.trim() || c.normalizedText;
        const updated: ClaimDoc = { ...c, normalizedText, status: 'confirmed', selected: true, debateId: debateIdFor(c.claimId) };
        updated.cacheKey = claimCacheKey(updated);
        const topic = buildTopic(updated, current);
        updated.topicHash = topic.topicHash;
        tx.set(col(C.claims).doc(c.claimId), updated);
        tx.set(col(C.debates).doc(topic.debateId), {
          debateId: topic.debateId,
          claimId: c.claimId,
          jobId,
          userId: user.uid,
          mode: null,
          status: 'pending',
          topic,
          createdAtMs: Date.now(),
        });
      } else {
        tx.update(col(C.claims).doc(c.claimId), { selected: false, outcome: 'skipped' });
      }
    }
    tx.update(jobRef(jobId), { confirmedAt: Date.now(), currentStage: 'triage', lastActivityAt: Date.now() });
    writeEventsInTx(tx, jobId, user.uid, current.eventSeq, [
      { type: 'job_status', summary: chosen.map((s) => s.normalizedText?.trim() || byId.get(s.claimId)!.normalizedText).join(' • '), data: { status: 'confirmed', claimIds: chosen.map((s) => s.claimId) } },
    ]);
  });
}

/** Retry, "Run deeper investigation", or a topic edit: a new job; a running old job becomes superseded. */
export async function createFollowupJob(
  user: AuthedUser,
  oldJobId: string,
  opts: { claimIds: string[]; deep: boolean; editedTopic?: { claimId: string; normalizedText: string } },
) {
  const { job: old, claims } = await loadJobState(oldJobId);
  if (old.userId !== user.uid) throw new AppError('NOT_FOUND', 'Not found.');
  const source = claims.filter((c) => opts.claimIds.includes(c.claimId) && c.status !== 'not_verifiable');
  if (!source.length) throw new AppError('INVALID_INPUT', 'No verifiable claims were selected.');
  const jobId = newId();

  await db().runTransaction(async (tx) => {
    const oldSnap = await tx.get(jobRef(oldJobId));
    const oldCurrent = oldSnap.data() as JobDoc;
    const commitQuota = await consumeVerificationQuota(tx, user.uid);
    const job = newJob({
      jobId,
      submissionId: old.submissionId,
      user,
      sourceType: old.sourceType,
      fileId: old.fileId,
      classroomId: old.classroomId,
      assignmentId: old.assignmentId,
      deep: opts.deep,
      supersedes: oldJobId,
      prefilledClaims: true,
      outputLanguage: user.preferredLanguage,
    });
    commitQuota();
    tx.set(jobRef(jobId), { ...job, createdAt: FieldValue.serverTimestamp(), startedAt: FieldValue.serverTimestamp() });
    source.forEach((c, i) => {
      const claimId = `${jobId}_c${i + 1}`;
      const normalizedText = opts.editedTopic?.claimId === c.claimId ? opts.editedTopic.normalizedText.trim() : c.normalizedText;
      const claim: ClaimDoc = {
        ...c,
        claimId,
        jobId,
        order: i,
        normalizedText,
        status: 'confirmed',
        selected: true,
        complexityClass: null,
        timeSensitivity: null,
        queryLanguages: null,
        debateId: debateIdFor(claimId),
        debateMode: null,
        topicHash: null,
        outcome: 'pending',
        verdict: null,
        failure: null,
      };
      claim.cacheKey = claimCacheKey(claim);
      const topic = buildTopic(claim, job);
      claim.topicHash = topic.topicHash;
      tx.set(col(C.claims).doc(claimId), { ...claim, createdAt: FieldValue.serverTimestamp() });
      tx.set(col(C.debates).doc(topic.debateId), {
        debateId: topic.debateId,
        claimId,
        jobId,
        userId: user.uid,
        mode: null,
        status: 'pending',
        topic,
        createdAtMs: Date.now(),
      });
    });
    writeEventsInTx(tx, jobId, user.uid, 0, [
      { type: 'job_status', summary: null, data: { status: 'queued', supersedes: oldJobId, deep: opts.deep } },
    ]);
    if (!TERMINAL_JOB_STATUSES.includes(oldCurrent.status)) {
      tx.update(jobRef(oldJobId), { status: 'superseded', supersededBy: jobId, completedAtMs: Date.now() });
      writeEventsInTx(tx, oldJobId, user.uid, oldCurrent.eventSeq, [
        { type: 'job_status', summary: null, data: { status: 'superseded', supersededBy: jobId } },
      ]);
    }
    tx.update(col(C.submissions).doc(old.submissionId), { currentJobId: jobId });
  });
  await auditLog(user.uid, opts.deep ? 'verification_deeper' : opts.editedTopic ? 'verification_topic_edited' : 'verification_retry', jobId, { from: oldJobId });
  return { jobId };
}

export async function cancelJob(user: AuthedUser, jobId: string) {
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(jobRef(jobId));
    const job = snap.data() as JobDoc | undefined;
    if (!job || job.userId !== user.uid) throw new AppError('NOT_FOUND', 'Not found.');
    if (TERMINAL_JOB_STATUSES.includes(job.status)) return;
    tx.update(jobRef(jobId), { status: 'cancelled', completedAtMs: Date.now() });
    writeEventsInTx(tx, jobId, user.uid, job.eventSeq, [{ type: 'job_status', summary: null, data: { status: 'cancelled' } }]);
  });
}

/** Persists the honest `paused` state when the page has stopped calling advance. */
export async function getJobView(jobId: string) {
  const { job, claims, runs } = await loadJobState(jobId);
  const status = effectiveStatus(job, runs);
  if (status === 'paused' && job.status !== 'paused') {
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(jobRef(jobId));
      const cur = snap.data() as JobDoc;
      if (cur.status !== 'processing') return;
      tx.update(jobRef(jobId), { status: 'paused' });
      writeEventsInTx(tx, jobId, cur.userId, cur.eventSeq, [
        { type: 'job_status', summary: 'The investigation is paused and will resume when you reopen it.', data: { status: 'paused' } },
      ]);
    });
    job.status = 'paused';
  }
  const previous = await Promise.all(
    claims.map(async (c) => {
      if (c.status === 'not_verifiable') return null;
      const rows = await orderedQuery({
        name: 'verificationResults by user and cacheKey',
        base: col(C.results).where('userId', '==', job.userId).where('cacheKey', '==', c.cacheKey),
        orderBy: 'completedAtMs',
        direction: 'desc',
        limit: 3,
      });
      const hit = rows.find((r) => r.claimId !== c.claimId && r.jobId !== jobId);
      return hit
        ? { claimId: c.claimId, resultClaimId: hit.claimId as string, verdict: hit.verdict as string, completedAtMs: hit.completedAtMs as number, timeSensitivity: hit.timeSensitivity as string | null }
        : null;
    }),
  );
  return {
    job: { ...job, status },
    claims,
    stages: [...runs.values()].sort((a, b) => (a.startedAtMs ?? Infinity) - (b.startedAtMs ?? Infinity)),
    previousResults: previous.filter(Boolean),
  };
}
