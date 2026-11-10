// Finalize: derive the job status from the real claim outcomes (PART 10.2).
import { FieldValue } from 'firebase-admin/firestore';
import type { JobStatus } from '../../../shared/schemas';
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
