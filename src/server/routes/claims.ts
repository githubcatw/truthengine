import { Router } from 'express';
import { orderedQuery } from '../firestoreQuery';
import { z } from 'zod';
import { assertCanRead } from '../access';
import { requireAuth, type AuthedUser } from '../auth';
import { handler, parse, rateLimit } from '../http';
import { C, col } from '../pipeline/store';
import type { ClaimDoc, JobDoc } from '../pipeline/types';

export const claimsRouter = Router();
claimsRouter.use(requireAuth, rateLimit);

async function loadClaimForRead(claimId: string, user: AuthedUser) {
  const snap = await col(C.claims).doc(claimId).get();
  const claim = snap.data() as ClaimDoc | undefined;
  const jobSnap = claim ? await col(C.jobs).doc(claim.jobId).get() : null;
  const job = jobSnap?.data() as JobDoc | undefined;
  await assertCanRead(job ? { userId: claim!.userId, classroomId: job.classroomId } : null, user);
  return { claim: claim!, job: job! };
}

const byNumericId = (key: string) => (a: Record<string, unknown>, b: Record<string, unknown>) =>
  String(a[key]).localeCompare(String(b[key]), undefined, { numeric: true });

/** Full stored report for one claim. Everything returned is a stored record with its ID. */
claimsRouter.get(
  '/:claimId',
  handler(async (req) => {
    const { claim, job } = await loadClaimForRead(req.params.claimId!, req.user!);
    const debateId = claim.debateId ?? `${claim.claimId}_debate`;
    const [debate, evidence, messages, challenges, decision, result, explanation, exercises, analyses] = await Promise.all([
      col(C.debates).doc(debateId).get(),
      col(C.evidence).where('claimId', '==', claim.claimId).get(),
      col(C.messages).where('debateId', '==', debateId).get(),
      col(C.challenges).where('debateId', '==', debateId).get(),
      col(C.decisions).doc(`${claim.claimId}_judge`).get(),
      col(C.results).doc(claim.claimId).get(),
      col(C.explanations).doc(claim.claimId).get(),
      col(C.exercises).where('claimId', '==', claim.claimId).get(),
      col(C.analyses).where('claimId', '==', claim.claimId).get(),
    ]);
    const isOwner = claim.userId === req.user!.uid;
    return {
      claim,
      job: { jobId: job.jobId, status: job.status, deep: job.deep, startedAtMs: job.startedAtMs, completedAtMs: job.completedAtMs, submissionId: job.submissionId },
      debate: debate.data() ?? null,
      evidence: evidence.docs.map((d) => d.data()).sort(byNumericId('evidenceId')),
      messages: messages.docs.map((d) => d.data()).sort((a, b) => a.order - b.order),
      challenges: challenges.docs.map((d) => d.data()).sort(byNumericId('challengeId')),
      decision: decision.data() ?? null,
      result: result.data() ?? null,
      explanation: explanation.data() ?? null,
      // The correct option is revealed only after the student has answered.
      exercises: exercises.docs.map((d) => d.data()).map((e) => (isOwner && e.attempt ? e : { ...e, correctIndex: undefined })),
      research: analyses.docs
        .map((d) => d.data())
        .filter((a) => a.agentType === 'researcher' || a.agentType === 'triage')
        .map((a) => ({ agentType: a.agentType, stageKey: a.stageKey, output: a.agentType === 'researcher' ? { used: a.structuredOutput.used, stopReason: a.structuredOutput.stopReason, executedQueries: a.structuredOutput.executedQueries } : a.structuredOutput })),
      readOnly: !isOwner,
    };
  }),
);

claimsRouter.get(
  '/:claimId/research-log',
  handler(async (req) => {
    const { claim } = await loadClaimForRead(req.params.claimId!, req.user!);
    const { after, limit } = parse(z.object({ after: z.coerce.number().default(0), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    const items = await orderedQuery({
      name: 'researchLog by claim',
      base: col(C.researchLog).where('claimId', '==', claim.claimId),
      orderBy: 'timestampMs',
      direction: 'asc',
      limit,
      after,
    });
    return { items, nextAfter: items.length === limit ? (items.at(-1)!.timestampMs as number) : null };
  }),
);
