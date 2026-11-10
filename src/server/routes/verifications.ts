import { Router } from 'express';
import { z } from 'zod';
import { ConfirmClaimsSchema, CreateSubmissionSchema, EditTopicSchema, FollowupSchema } from '../../shared/api';
import { loadJobForRead } from '../access';
import { requireAuth } from '../auth';
import { AppError } from '../errors';
import { handler, parse, rateLimit } from '../http';
import { auditLog, cancelJob, confirmClaims, createFollowupJob, createSubmission, getJobView } from '../pipeline/jobs';
import { advance } from '../pipeline/runner';
import { C, col, eventsCol } from '../pipeline/store';
import type { ClaimDoc, JobDoc } from '../pipeline/types';

export const verificationsRouter = Router();
verificationsRouter.use(requireAuth, rateLimit);

async function ownJob(jobId: string, uid: string): Promise<JobDoc> {
  const snap = await col(C.jobs).doc(jobId).get();
  const job = snap.data() as JobDoc | undefined;
  if (!job || job.userId !== uid) throw new AppError('NOT_FOUND', 'Not found.');
  return job;
}

verificationsRouter.post(
  '/',
  handler(async (req) => {
    const body = parse(CreateSubmissionSchema, req.body);
    const r = await createSubmission(req.user!, body);
    if (!r.duplicate) await auditLog(req.user!.uid, 'verification_created', r.jobId, { sourceType: body.fileId ? 'document' : 'text' });
    return r;
  }),
);

/** History: the user's own jobs, newest first, paginated. Superseded jobs are hidden. */
verificationsRouter.get(
  '/',
  handler(async (req) => {
    const { cursor, limit } = parse(
      z.object({ cursor: z.coerce.number().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }),
      req.query,
    );
    let q = col(C.jobs).where('userId', '==', req.user!.uid).orderBy('startedAtMs', 'desc');
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.limit(limit).get();
    const jobs = snap.docs.map((d) => d.data() as JobDoc);
    return {
      items: jobs
        .filter((j) => j.status !== 'superseded')
        .map((j) => ({
          jobId: j.jobId,
          status: j.status,
          startedAtMs: j.startedAtMs,
          completedAtMs: j.completedAtMs,
          sourceType: j.sourceType,
          claimSummaries: j.claimSummaries,
          deep: j.deep,
        })),
      nextCursor: jobs.length === limit ? jobs.at(-1)!.startedAtMs : null,
    };
  }),
);

verificationsRouter.get(
  '/:jobId',
  handler(async (req) => {
    const { asTeacher } = await loadJobForRead(req.params.jobId!, req.user!);
    const view = await getJobView(req.params.jobId!);
    return { ...view, readOnly: asTeacher };
  }),
);

verificationsRouter.post(
  '/:jobId/advance',
  handler(async (req) => {
    await ownJob(req.params.jobId!, req.user!.uid);
    const r = await advance(req.params.jobId!);
    const view = await getJobView(req.params.jobId!);
    return { ...view, ran: r.ran, busy: r.busy };
  }),
);

verificationsRouter.post(
  '/:jobId/confirm',
  handler(async (req) => {
    const body = parse(ConfirmClaimsSchema, req.body);
    await confirmClaims(req.user!, req.params.jobId!, body.claims);
    await auditLog(req.user!.uid, 'claims_confirmed', req.params.jobId!, { count: body.claims.filter((c) => c.selected).length });
    return getJobView(req.params.jobId!);
  }),
);

verificationsRouter.post(
  '/:jobId/cancel',
  handler(async (req) => {
    await cancelJob(req.user!, req.params.jobId!);
    await auditLog(req.user!.uid, 'verification_cancelled', req.params.jobId!);
    return { ok: true };
  }),
);

verificationsRouter.post(
  '/:jobId/retry',
  handler(async (req) => {
    const job = await ownJob(req.params.jobId!, req.user!.uid);
    if (!job.confirmedAt) throw new AppError('CONFLICT', 'Confirm claims before retrying.');
    const claims = await col(C.claims).where('jobId', '==', job.jobId).get();
    const ids = claims.docs.map((d) => d.data() as ClaimDoc).filter((c) => c.status === 'confirmed' && c.selected).map((c) => c.claimId);
    const body = req.body?.claimIds ? parse(FollowupSchema, req.body) : { claimIds: ids };
    return createFollowupJob(req.user!, job.jobId, { claimIds: body.claimIds, deep: false });
  }),
);

/** "Run deeper investigation" for one claim: larger budget and full debate mode, as a new job. */
verificationsRouter.post(
  '/:jobId/claims/:claimId/deeper',
  handler(async (req) => {
    const job = await ownJob(req.params.jobId!, req.user!.uid);
    return createFollowupJob(req.user!, job.jobId, { claimIds: [req.params.claimId!], deep: true });
  }),
);

/** Editing the topic after the debate started supersedes the job and starts a new one. */
verificationsRouter.post(
  '/:jobId/claims/:claimId/topic',
  handler(async (req) => {
    const job = await ownJob(req.params.jobId!, req.user!.uid);
    const { normalizedText } = parse(EditTopicSchema, req.body);
    return createFollowupJob(req.user!, job.jobId, {
      claimIds: [req.params.claimId!],
      deep: job.deep,
      editedTopic: { claimId: req.params.claimId!, normalizedText },
    });
  }),
);

/** Paginated persisted events (the same records the realtime listener reads). */
verificationsRouter.get(
  '/:jobId/events',
  handler(async (req) => {
    await loadJobForRead(req.params.jobId!, req.user!);
    const { after, limit } = parse(
      z.object({ after: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(500).default(200) }),
      req.query,
    );
    const snap = await eventsCol(req.params.jobId!).where('seq', '>', after).orderBy('seq').limit(limit).get();
    const items = snap.docs.map((d) => d.data());
    return { items, nextAfter: items.length === limit ? (items.at(-1)!.seq as number) : null };
  }),
);

verificationsRouter.get(
  '/:jobId/findings',
  handler(async (req) => {
    const { job } = await loadJobForRead(req.params.jobId!, req.user!);
    // Findings belong to the submission's document, so follow-up jobs show the original audit.
    const snap = await col(C.qualityFindings).where('submissionId', '==', (job as unknown as JobDoc).submissionId).get();
    return { items: snap.docs.map((d) => d.data()).sort((a, b) => String(a.findingId).localeCompare(String(b.findingId), undefined, { numeric: true })) };
  }),
);
