// Resumable server-side stage runner (PART 10.1 / 10.2).
//
// There is no durable background worker in this runtime, so work happens only
// inside `advance` calls made by the open Live Investigation page. Each call
// runs the next ready stages under Firestore leases and persists their output
// before returning. When nobody calls `advance`, the job is reported `paused`.
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { PIPELINE } from '../config';
import { AppError } from '../errors';
import { db } from '../firebase';
import { log } from '../logger';
import { getGeminiClient } from '../ai/gemini';
import { TERMINAL_JOB_STATUSES } from '../../shared/schemas';
import { isStageDone, planStages } from './plan';
import { C, col, jobRef, leaseOwnerId, persistWithEvents, stageRef, writeEventsInTx, type EventInput } from './store';
import type { ClaimDoc, JobDoc, StageContext, StageDef, StageRunDoc } from './types';

const NON_RETRYABLE = new Set(['AI_OUTPUT_INVALID', 'GEMINI_NOT_CONFIGURED', 'GEMINI_INVALID_KEY', 'INVALID_INPUT', 'FIREBASE_NOT_CONFIGURED']);
/** Configuration errors fail the whole job: no claim can succeed without the service. */
const JOB_FATAL = new Set(['GEMINI_NOT_CONFIGURED', 'GEMINI_INVALID_KEY', 'FIREBASE_NOT_CONFIGURED']);

export async function loadJobState(jobId: string) {
  const [jobSnap, claimSnap, runSnap] = await Promise.all([
    jobRef(jobId).get(),
    col(C.claims).where('jobId', '==', jobId).get(),
    jobRef(jobId).collection('stageRuns').get(),
  ]);
  if (!jobSnap.exists) throw new AppError('NOT_FOUND', 'Not found.');
  const job = jobSnap.data() as JobDoc;
  const claims = claimSnap.docs.map((d) => d.data() as ClaimDoc).sort((a, b) => a.order - b.order);
  const runs = new Map<string, StageRunDoc>(runSnap.docs.map((d) => [(d.data() as StageRunDoc).stageKey, d.data() as StageRunDoc]));
  return { job, claims, runs };
}

function hasLiveLease(runs: Map<string, StageRunDoc>, now: number): boolean {
  return [...runs.values()].some((r) => r.status === 'leased' && (r.leaseExpiresAt ?? 0) > now);
}

/** Effective status: a processing job with no recent advance call and no live lease is paused. */
export function effectiveStatus(job: JobDoc, runs: Map<string, StageRunDoc>, now = Date.now()): JobDoc['status'] {
  if (job.status === 'processing' && now - job.lastActivityAt > PIPELINE.pauseAfterIdleMs && !hasLiveLease(runs, now)) {
    return 'paused';
  }
  return job.status;
}

export function readyStages(job: JobDoc, claims: ClaimDoc[], runs: Map<string, StageRunDoc>, now = Date.now()): StageDef[] {
  const defs = planStages(job, claims, runs);
  return defs.filter((d) => {
    const run = runs.get(d.key);
    if (isStageDone(run, d.critical) || run?.status === 'failed') return false;
    if (run?.status === 'leased' && (run.leaseExpiresAt ?? 0) > now) return false;
    if (run?.nextRetryAt && run.nextRetryAt > now) return false;
    if (!d.deps.every((k) => isStageDone(runs.get(k)))) return false;
    return d.ready ? d.ready() : true;
  });
}

/** Picks at most `claimConcurrency` stages, preferring one stage per claim. */
function pick(ready: StageDef[]): StageDef[] {
  const out: StageDef[] = [];
  const seen = new Set<string | null>();
  for (const d of ready) {
    if (out.length >= PIPELINE.claimConcurrency) break;
    if (seen.has(d.claimId)) continue;
    seen.add(d.claimId);
    out.push(d);
  }
  return out;
}

export interface AdvanceResult {
  ran: string[];
  busy: boolean;
}

export async function advance(jobId: string): Promise<AdvanceResult> {
  const { job, claims, runs } = await loadJobState(jobId);
  if (TERMINAL_JOB_STATUSES.includes(job.status)) return { ran: [], busy: false };

  const now = Date.now();
  const patch: Record<string, unknown> = { lastActivityAt: now };
  if (job.status === 'queued' || job.status === 'paused') patch.status = 'processing';
  await jobRef(jobId).update(patch);
  if (job.status === 'paused') {
    await persistWithEvents(jobId, job.userId, () => undefined, [
      { type: 'job_status', summary: 'Investigation resumed.', data: { status: 'processing' } },
    ]);
  }
  job.status = 'processing';
  job.lastActivityAt = now;

  if (!job.confirmedAt && isStageDone(runs.get('extract_claims')) && job.currentStage !== 'awaiting_confirmation') {
    await jobRef(jobId).update({ currentStage: 'awaiting_confirmation' });
  }

  // Per-job processing-time limit (PART 9.6): stop honestly instead of running without end.
  if ((job.processingMs ?? 0) > PIPELINE.maxJobProcessingMs && !hasLiveLease(runs, now)) {
    const message = `The investigation exceeded its processing time limit (${Math.round(PIPELINE.maxJobProcessingMs / 60_000)} minutes). Completed results are kept.`;
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(jobRef(jobId));
      const cur = snap.data() as JobDoc;
      if (TERMINAL_JOB_STATUSES.includes(cur.status)) return;
      const judged = claims.some((c) => c.outcome === 'judged');
      tx.update(jobRef(jobId), {
        status: judged ? 'partially_completed' : 'failed',
        errorDetails: { code: 'INTERNAL', message },
        completedAtMs: now,
        completedAt: FieldValue.serverTimestamp(),
      });
      writeEventsInTx(tx, jobId, cur.userId, cur.eventSeq, [{ type: 'job_status', summary: message, data: { status: judged ? 'partially_completed' : 'failed' } }]);
    });
    return { ran: [], busy: false };
  }
  const chosen = pick(readyStages(job, claims, runs, now));
  if (!chosen.length) return { ran: [], busy: hasLiveLease(runs, now) };
  const ran = await Promise.all(chosen.map((d) => runStage(job, claims, d)));
  return { ran: chosen.filter((_, i) => ran[i]).map((d) => d.key), busy: false };
}

async function acquireLease(job: JobDoc, def: StageDef, owner: string): Promise<boolean> {
  const ref = stageRef(job.jobId, def.key);
  return db().runTransaction(async (tx) => {
    const [snap, jobSnap] = await Promise.all([tx.get(ref), tx.get(jobRef(job.jobId))]);
    const current = jobSnap.data() as JobDoc;
    if (TERMINAL_JOB_STATUSES.includes(current.status)) return false;
    const now = Date.now();
    const prev = snap.exists ? (snap.data() as StageRunDoc) : null;
    if (prev && (prev.status === 'completed' || prev.status === 'skipped' || prev.status === 'failed')) return false;
    if (prev?.status === 'leased' && (prev.leaseExpiresAt ?? 0) > now) return false;
    const attempts = (prev?.attempts ?? 0) + 1;
    const stalled = prev?.status === 'leased'; // previous lease expired without completing
    const run: StageRunDoc = {
      stageKey: def.key,
      status: 'leased',
      leaseOwner: owner,
      leaseExpiresAt: now + PIPELINE.stageLeaseMs,
      attempts,
      nextRetryAt: null,
      startedAtMs: now,
      completedAtMs: null,
      durationMs: null,
      aiCalls: prev?.aiCalls ?? 0,
      errorCode: stalled ? 'STALLED' : (prev?.errorCode ?? null),
      errorMessage: stalled ? 'The previous attempt was interrupted.' : (prev?.errorMessage ?? null),
      outputRef: null,
    };
    tx.set(ref, run);
    tx.update(jobRef(job.jobId), { currentStage: def.key });
    writeEventsInTx(tx, job.jobId, job.userId, current.eventSeq ?? 0, [
      {
        type: attempts > 1 ? 'stage_retry' : 'stage_started',
        stageKey: def.key,
        claimId: def.claimId,
        data: { attempt: attempts },
      },
    ]);
    return true;
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new AppError('INTERNAL', 'The stage exceeded its time limit.', { timeout: true })), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** Returns true if the stage ran (completed or failed) in this call. */
export async function runStage(job: JobDoc, claims: ClaimDoc[], def: StageDef): Promise<boolean> {
  const owner = leaseOwnerId();
  if (!(await acquireLease(job, def, owner))) return false;
  const started = Date.now();
  const counter = { aiCalls: 0 };
  const ctx: StageContext = {
    job,
    claims,
    claim: def.claimId ? (claims.find((c) => c.claimId === def.claimId) ?? null) : null,
    stageKey: def.key,
    gemini: getGeminiClient,
    counter,
    live: (apply, events) =>
      persistWithEvents(job.jobId, job.userId, apply, events.map((e) => ({ stageKey: def.key, claimId: def.claimId, ...e }))),
  };

  try {
    const result = await withTimeout(def.run(ctx), PIPELINE.maxStageMs);
    await db().runTransaction(async (tx) => {
      const ref = stageRef(job.jobId, def.key);
      const [stageSnap, jobSnap] = await Promise.all([tx.get(ref), tx.get(jobRef(job.jobId))]);
      const run = stageSnap.data() as StageRunDoc | undefined;
      if (!run || run.leaseOwner !== owner || run.status !== 'leased') {
        throw new AppError('CONFLICT', 'Stage lease lost; output discarded.');
      }
      const current = jobSnap.data() as JobDoc;
      result.apply?.(tx);
      if (def.claimId && result.claimOutcome) {
        tx.update(col(C.claims).doc(def.claimId), {
          outcome: result.claimOutcome.outcome,
          failure: result.claimOutcome.failure ?? null,
        });
      }
      const now = Date.now();
      tx.update(ref, {
        status: 'completed',
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAtMs: now,
        durationMs: now - started,
        aiCalls: FieldValue.increment(counter.aiCalls),
        errorCode: null,
        errorMessage: null,
        outputRef: result.outputRef ?? null,
      });
      tx.update(jobRef(job.jobId), { aiCalls: FieldValue.increment(counter.aiCalls), processingMs: FieldValue.increment(now - started), lastActivityAt: now });
      const events: EventInput[] = [
        ...(result.events ?? []).map((e) => ({ stageKey: def.key, claimId: def.claimId, ...e })),
        { type: 'stage_completed', stageKey: def.key, claimId: def.claimId, data: { durationMs: now - started, aiCalls: counter.aiCalls } },
      ];
      writeEventsInTx(tx, job.jobId, job.userId, current.eventSeq ?? 0, events);
    });
  } catch (err) {
    if (err instanceof AppError && err.code === 'CONFLICT') return false;
    await recordFailure(job, def, owner, err, counter.aiCalls, started);
  }
  return true;
}

async function recordFailure(job: JobDoc, def: StageDef, owner: string, err: unknown, aiCalls: number, started: number) {
  const appErr = err instanceof AppError ? err : new AppError('INTERNAL', 'The stage failed unexpectedly.');
  if (!(err instanceof AppError)) log.error('stage crashed', { stage: def.key, name: (err as Error)?.name, code: (err as { code?: unknown })?.code ?? null, message: String((err as Error)?.message ?? '').slice(0, 1000) });
  // Diagnostic detail for invalid AI output: field paths and messages only, quoted text removed.
  const problem = (appErr.detail as { problem?: string } | undefined)?.problem;
  const errorDetail = problem ? problem.replace(/"[^"]*"/g, '"…"').slice(0, 500) : null;
  if (appErr.status >= 500 || appErr.code === 'AI_OUTPUT_INVALID') log.warn('stage failed', { stage: def.key, code: appErr.code, detail: errorDetail });
  const ref = stageRef(job.jobId, def.key);
  await db().runTransaction(async (tx: Transaction) => {
    const [stageSnap, jobSnap] = await Promise.all([tx.get(ref), tx.get(jobRef(job.jobId))]);
    const run = stageSnap.data() as StageRunDoc | undefined;
    if (!run || run.leaseOwner !== owner) return;
    const current = jobSnap.data() as JobDoc;
    const now = Date.now();
    const retryable = !NON_RETRYABLE.has(appErr.code) && run.attempts < PIPELINE.maxStageAttempts;
    const delay = appErr.code === 'GEMINI_QUOTA_EXHAUSTED' ? 60_000 : PIPELINE.retryBaseDelayMs * 2 ** (run.attempts - 1);
    tx.update(ref, {
      status: retryable ? 'pending' : 'failed',
      leaseOwner: null,
      leaseExpiresAt: null,
      nextRetryAt: retryable ? now + delay : null,
      durationMs: now - started,
      aiCalls: FieldValue.increment(aiCalls),
      errorCode: appErr.code,
      errorMessage: appErr.message,
      errorDetail,
    });
    tx.update(jobRef(job.jobId), { aiCalls: FieldValue.increment(aiCalls), processingMs: FieldValue.increment(now - started) });
    const events: EventInput[] = [
      {
        type: 'stage_failed',
        stageKey: def.key,
        claimId: def.claimId,
        summary: appErr.message,
        data: { code: appErr.code, willRetry: retryable, attempt: run.attempts },
      },
    ];
    if (!retryable && def.critical) {
      const failure = { stageKey: def.key, code: appErr.code, message: appErr.message };
      if (JOB_FATAL.has(appErr.code) || !def.claimId) {
        tx.update(jobRef(job.jobId), {
          status: 'failed',
          errorDetails: { code: appErr.code, message: appErr.message },
          completedAtMs: now,
          completedAt: FieldValue.serverTimestamp(),
        });
        events.push({ type: 'job_status', summary: appErr.message, data: { status: 'failed' } });
      } else {
        tx.update(col(C.claims).doc(def.claimId), { outcome: 'failed', failure });
      }
    }
    writeEventsInTx(tx, job.jobId, job.userId, current.eventSeq ?? 0, events);
  });
}


