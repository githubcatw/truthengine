import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { db } from '../../src/server/firebase';
import { getJobView } from '../../src/server/pipeline/jobs';
import { runStage } from '../../src/server/pipeline/runner';
import { jobRef, stageRef } from '../../src/server/pipeline/store';
import type { JobDoc, StageDef, StageRunDoc } from '../../src/server/pipeline/types';
import { clearEmulators } from '../helpers/harness';

function job(jobId: string, patch: Partial<JobDoc> = {}): JobDoc {
  return {
    jobId,
    submissionId: 's1',
    userId: 'u1',
    status: 'processing',
    currentStage: 'x',
    supersededBy: null,
    supersedes: null,
    deep: false,
    outputLanguage: 'en',
    gradeLevel: null,
    sourceType: 'text',
    fileId: null,
    classroomId: null,
    assignmentId: null,
    prefilledClaims: false,
    confirmedAt: null,
    eventSeq: 0,
    lastActivityAt: Date.now(),
    startedAtMs: Date.now(),
    completedAtMs: null,
    errorDetails: null,
    claimSummaries: [],
    aiCalls: 0,
    ...patch,
  };
}

async function seed(j: JobDoc) {
  await jobRef(j.jobId).set(j);
  return j;
}

const stage = async (jobId: string, key: string) => (await stageRef(jobId, key).get()).data() as StageRunDoc;

beforeEach(clearEmulators);

describe('stage leases and retries', () => {
  it('the same stage never executes twice concurrently', async () => {
    const j = await seed(job('lease-job'));
    let runs = 0;
    const def: StageDef = {
      key: 'demo_stage',
      deps: [],
      claimId: null,
      critical: true,
      run: async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 300));
        return {};
      },
    };
    const results = await Promise.all([runStage(j, [], def), runStage(j, [], def), runStage(j, [], def)]);
    expect(runs).toBe(1);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await stage(j.jobId, 'demo_stage')).status).toBe('completed');
    // A completed stage is never repeated.
    expect(await runStage(j, [], def)).toBe(false);
    expect(runs).toBe(1);
  });

  it('retries are capped with backoff, then the stage fails with its real error', async () => {
    const j = await seed(job('retry-job'));
    const def: StageDef = {
      key: 'flaky',
      deps: [],
      claimId: null,
      critical: true,
      run: async () => {
        throw new AppError('INTERNAL', 'Upstream timed out.');
      },
    };
    await runStage(j, [], def);
    let s = await stage(j.jobId, 'flaky');
    expect(s.status).toBe('pending');
    expect(s.nextRetryAt).toBeGreaterThan(Date.now());
    for (let i = 0; i < 2; i++) {
      await stageRef(j.jobId, 'flaky').update({ nextRetryAt: null });
      await runStage(j, [], def);
    }
    s = await stage(j.jobId, 'flaky');
    expect(s.status).toBe('failed');
    expect(s.attempts).toBe(3);
    expect(s.errorMessage).toBe('Upstream timed out.');
    expect(await runStage(j, [], def)).toBe(false);
    const jobDoc = (await jobRef(j.jobId).get()).data() as JobDoc;
    expect(jobDoc.status).toBe('failed');
    expect(jobDoc.errorDetails?.message).toBe('Upstream timed out.');
  });

  it('a stalled stage (expired lease after a server interruption) resumes on the next advance', async () => {
    const j = await seed(job('resume-job'));
    await stageRef(j.jobId, 'interrupted').set({
      stageKey: 'interrupted',
      status: 'leased',
      leaseOwner: 'dead-process',
      leaseExpiresAt: Date.now() - 1000,
      attempts: 1,
      nextRetryAt: null,
      startedAtMs: Date.now() - 60_000,
      completedAtMs: null,
      durationMs: null,
      aiCalls: 0,
      errorCode: null,
      errorMessage: null,
      outputRef: null,
    } satisfies StageRunDoc);
    let ran = false;
    const def: StageDef = { key: 'interrupted', deps: [], claimId: null, critical: true, run: async () => ((ran = true), {}) };
    expect(await runStage(j, [], def)).toBe(true);
    expect(ran).toBe(true);
    const s = await stage(j.jobId, 'interrupted');
    expect(s.status).toBe('completed');
    expect(s.attempts).toBe(2);
  });

  it('a live lease held by another process blocks execution', async () => {
    const j = await seed(job('busy-job'));
    await stageRef(j.jobId, 'held').set({ stageKey: 'held', status: 'leased', leaseOwner: 'other', leaseExpiresAt: Date.now() + 60_000, attempts: 1 });
    let ran = false;
    expect(await runStage(j, [], { key: 'held', deps: [], claimId: null, critical: true, run: async () => ((ran = true), {}) })).toBe(false);
    expect(ran).toBe(false);
  });

  it('output of a stage whose lease was lost is discarded', async () => {
    const j = await seed(job('lost-job'));
    const def: StageDef = {
      key: 'slow',
      deps: [],
      claimId: null,
      critical: true,
      run: async () => {
        // Another process takes over the lease meanwhile.
        await stageRef(j.jobId, 'slow').update({ leaseOwner: 'someone-else' });
        return { apply: (tx) => tx.set(db().collection('auditLogs').doc('should-not-exist'), { x: 1 }) };
      },
    };
    await runStage(j, [], def);
    expect((await db().collection('auditLogs').doc('should-not-exist').get()).exists).toBe(false);
  });
});

describe('honest pause behaviour', () => {
  it('a job nobody advances becomes paused, with an explanatory event', async () => {
    const j = await seed(job('pause-job', { lastActivityAt: Date.now() - 10 * 60_000 }));
    const view = await getJobView(j.jobId);
    expect(view.job.status).toBe('paused');
    const stored = (await jobRef(j.jobId).get()).data() as JobDoc;
    expect(stored.status).toBe('paused');
    const events = await jobRef(j.jobId).collection('events').get();
    expect(events.docs.map((d) => d.get('summary'))).toContain('The investigation is paused and will resume when you reopen it.');
  });
});
