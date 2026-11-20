// Finalize: derive the job status from the real claim outcomes (PART 10.2).
import { FieldValue } from 'firebase-admin/firestore';
import type { JobStatus } from '../../../shared/schemas';
import { log } from '../../logger';
import { activeClaims } from '../plan';
import { C, col, jobRef } from '../store';
import type { ClaimDoc, StageContext, StageResult } from '../types';

export function finalStatus(claims: ClaimDoc[]): JobStatus {
  const active = activeClaims(claims);
  const judged = active.filter((c) => c.outcome === 'judged').length;
  if (active.length && judged === active.length) return 'completed';
  if (judged > 0) return 'partially_completed';
  if (active.length && active.every((c) => c.outcome === 'research_failed')) return 'research_failed';
  return 'failed';
}

export async function runFinalize(ctx: StageContext): Promise<StageResult> {
  // Reload claims: outcomes were written by earlier stages after this advance started.
  const snap = await col(C.claims).where('jobId', '==', ctx.job.jobId).get();
  const claims = snap.docs.map((d) => d.data() as ClaimDoc).sort((a, b) => a.order - b.order);
  const status = finalStatus(claims);
  const summaries = activeClaims(claims).map((c) => ({
    claimId: c.claimId,
    normalizedText: c.normalizedText,
    outcome: c.outcome,
    verdict: c.verdict,
  }));
  const now = Date.now();

  // Real measured timings for the logs (PART 10.6 / 20): no user content, only durations and counts.
  const runs = (await jobRef(ctx.job.jobId).collection('stageRuns').get()).docs.map((d) => d.data());
  const byKind: Record<string, { n: number; totalMs: number; maxMs: number; aiCalls: number }> = {};
  for (const r of runs) {
    const parts = String(r.stageKey).split(':');
    const kind = parts[0] === 'debate' ? `debate:${parts[2]}` : parts[0]!;
    const k = (byKind[kind] ??= { n: 0, totalMs: 0, maxMs: 0, aiCalls: 0 });
    k.n++;
    k.totalMs += r.durationMs ?? 0;
    k.maxMs = Math.max(k.maxMs, r.durationMs ?? 0);
    k.aiCalls += r.aiCalls ?? 0;
  }
  const jobSnap = await jobRef(ctx.job.jobId).get();
  log.info('job finished', {
    jobId: ctx.job.jobId,
    status,
    wallMs: now - ctx.job.startedAtMs,
    processingMs: jobSnap.get('processingMs') ?? null,
    aiCalls: jobSnap.get('aiCalls') ?? null,
    claims: summaries.length,
    judged: summaries.filter((c) => c.outcome === 'judged').length,
    complexity: claims.filter((c) => c.selected && c.status === 'confirmed').map((c) => c.complexityClass),
    deep: ctx.job.deep,
    stages: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { n: v.n, avgMs: Math.round(v.totalMs / v.n), maxMs: v.maxMs, aiCalls: v.aiCalls }])),
  });

  return {
    outputRef: `status:${status}`,
    apply: (tx) => {
      tx.update(jobRef(ctx.job.jobId), {
        status,
        currentStage: 'done',
        completedAtMs: now,
        completedAt: FieldValue.serverTimestamp(),
        claimSummaries: summaries,
        errorDetails:
          status === 'research_failed'
            ? { code: 'RESEARCH_FAILED', message: 'No usable evidence with a verified excerpt was retrieved for any claim.' }
            : status === 'failed'
              ? { code: 'INTERNAL', message: 'No claim could be completed. See the failed stages for details.' }
              : null,
      });
      const n = col(C.notifications).doc(`${ctx.job.jobId}_done`);
      tx.set(n, {
        notificationId: n.id,
        userId: ctx.job.userId,
        type: 'verification_finished',
        jobId: ctx.job.jobId,
        status,
        read: false,
        createdAtMs: now,
      });
    },
    events: [{ type: 'job_status', summary: null, data: { status, durationMs: now - ctx.job.startedAtMs } }],
  };
}
