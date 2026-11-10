import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { adminAuth, db } from '../../src/server/firebase';
import { today } from '../../src/server/pipeline/jobs';
import { apiClient, clearEmulators, createUser, drive, fakeFetch, startServer, useGemini, type Api } from '../helpers/harness';
import { fakeGemini } from '../helpers/fakeGemini';

const fetchMock = vi.hoisted(() => ({ impl: null as null | ((u: string) => Promise<unknown>) }));
vi.mock('../../src/server/research/fetcher', async (orig) => {
  const real = await orig<typeof import('../../src/server/research/fetcher')>();
  return { ...real, fetchSource: (u: string) => fetchMock.impl!(u) };
});

const TEXT = 'The bridge across the river was completed in the autumn after five years of work.';
let server: Server;
let base: string;

beforeAll(async () => {
  ({ server, url: base } = await startServer());
});
afterAll(() => server.close());
beforeEach(async () => {
  await clearEmulators();
  fetchMock.impl = fakeFetch() as never;
  useGemini(fakeGemini());
});

async function completedJob(api: Api, text = TEXT) {
  const { body } = await api('POST', '/verifications', { text, idempotencyKey: `k-${Math.random()}` });
  const awaiting = await drive(api, body.jobId);
  await api('POST', `/verifications/${body.jobId}/confirm`, {
    claims: awaiting.claims.map((c: any) => ({ claimId: c.claimId, selected: c.status !== 'not_verifiable' })),
  });
  return drive(api, body.jobId);
}

describe('server-side authorization', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await fetch(`${base}/api/verifications`);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it("User A cannot read or drive User B's submissions, results or events", async () => {
    const a = await createUser('a@example.com');
    const b = await createUser('b@example.com');
    const apiA = apiClient(base, a.token);
    const apiB = apiClient(base, b.token);
    const done = await completedJob(apiA);
    const jobId = done.job.jobId;
    const claimId = done.job.claimSummaries[0].claimId;
    for (const [m, p] of [
      ['GET', `/verifications/${jobId}`],
      ['GET', `/verifications/${jobId}/events`],
      ['GET', `/verifications/${jobId}/findings`],
      ['POST', `/verifications/${jobId}/advance`],
      ['POST', `/verifications/${jobId}/retry`],
      ['GET', `/claims/${claimId}`],
      ['GET', `/claims/${claimId}/research-log`],
    ] as const) {
      const r = await apiB(m, p);
      expect(r.status, `${m} ${p}`).toBe(404);
    }
    expect((await apiB('GET', '/verifications')).body.items).toEqual([]);
  });

  it('new users are students and cannot assign themselves a role', async () => {
    const u = await createUser('s@example.com');
    const api = apiClient(base, u.token);
    expect((await api('GET', '/me')).body.role).toBe('student');
    const r = await api('PATCH', '/me', { role: 'admin' });
    expect(r.status).toBe(400);
    const r2 = await api('PATCH', '/me', { displayName: 'Ani', accountStatus: 'active' });
    expect(r2.status).toBe(400);
    expect((await api('GET', '/me')).body.role).toBe('student');
    expect((await api('PATCH', '/me', { displayName: 'Ani', preferredLanguage: 'hy', gradeLevel: 9 })).status).toBe(200);
  });

  it('the bootstrap administrator is granted admin only with a verified email', async () => {
    process.env.BOOTSTRAP_ADMIN_EMAILS = 'boss@example.com';
    try {
      const u = await createUser('boss@example.com');
      expect((await apiClient(base, u.token)('GET', '/me')).body.role).toBe('student');
      await adminAuth().updateUser(u.uid, { emailVerified: true });
      const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email, password: 'password123', returnSecureToken: true }),
      });
      const fresh = (await res.json()).idToken as string;
      expect((await apiClient(base, fresh)('GET', '/me')).body.role).toBe('admin');
      expect((await adminAuth().getUser(u.uid)).customClaims?.role).toBe('admin');
    } finally {
      delete process.env.BOOTSTRAP_ADMIN_EMAILS;
    }
  });

  it('enforces the daily verification limit with a clear message', async () => {
    const u = await createUser('busy@example.com');
    const api = apiClient(base, u.token);
    await api('GET', '/me');
    await db().collection('users').doc(u.uid).set({ usage: { day: today(), verifications: 9999, uploads: 0 } }, { merge: true });
    const r = await api('POST', '/verifications', { text: TEXT, idempotencyKey: 'limit-key-1' });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('USAGE_LIMIT');
  });
});

describe('caching and past results', () => {
  it('a past result is offered with its original date; other users never see it', async () => {
    const a = await createUser('cache-a@example.com');
    const apiA = apiClient(base, a.token);
    const first = await completedJob(apiA);
    const { body } = await apiA('POST', '/verifications', { text: TEXT, idempotencyKey: 'second-run' });
    const awaiting = await drive(apiA, body.jobId);
    expect(awaiting.previousResults).toHaveLength(1);
    expect(awaiting.previousResults[0].resultClaimId).toBe(first.job.claimSummaries[0].claimId);
    expect(awaiting.previousResults[0].completedAtMs).toBeLessThan(Date.now());

    const b = await createUser('cache-b@example.com');
    const apiB = apiClient(base, b.token);
    const { body: bJob } = await apiB('POST', '/verifications', { text: TEXT, idempotencyKey: 'b-run-key-1' });
    const bAwaiting = await drive(apiB, bJob.jobId);
    expect(bAwaiting.previousResults).toEqual([]);
  });
});

describe('superseding', () => {
  it('editing the topic during a run supersedes the old job and starts a new one', async () => {
    const u = await createUser('edit@example.com');
    const api = apiClient(base, u.token);
    const { body } = await api('POST', '/verifications', { text: TEXT, idempotencyKey: 'edit-run' });
    const awaiting = await drive(api, body.jobId);
    const claimId = awaiting.claims[0].claimId;
    await api('POST', `/verifications/${body.jobId}/confirm`, { claims: [{ claimId, selected: true }] });
    await api('POST', `/verifications/${body.jobId}/advance`); // triage only
    const edit = await api('POST', `/verifications/${body.jobId}/claims/${claimId}/topic`, { normalizedText: 'The bridge was completed in autumn.' });
    expect(edit.status).toBe(200);
    const old = await api('GET', `/verifications/${body.jobId}`);
    expect(old.body.job.status).toBe('superseded');
    expect(old.body.job.supersededBy).toBe(edit.body.jobId);
    expect((await api('POST', `/verifications/${body.jobId}/advance`)).body.ran).toEqual([]);
    const done = await drive(api, edit.body.jobId);
    expect(done.job.status).toBe('completed');
    expect(done.claims[0].normalizedText).toBe('The bridge was completed in autumn.');
    const newEvents = (await api('GET', `/verifications/${edit.body.jobId}/events?limit=500`)).body.items;
    expect(newEvents.every((e: any) => e.jobId === edit.body.jobId)).toBe(true);
  });
});

describe('Firestore security rules (direct client access)', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-truthengine-rules',
      firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: host!, port: Number(port) },
    });
  });
  afterAll(() => env.cleanup());

  it('owners can read their job and events; nobody else can; clients cannot write', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, 'verificationJobs/j1'), { userId: 'alice' });
      await setDoc(doc(fs, 'verificationJobs/j1/events/00000001'), { seq: 1 });
      await setDoc(doc(fs, 'claims/c1'), { userId: 'alice' });
      await setDoc(doc(fs, 'users/alice'), { role: 'student' });
    });
    const alice = env.authenticatedContext('alice').firestore();
    const bob = env.authenticatedContext('bob').firestore();
    const anon = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(alice, 'verificationJobs/j1')));
    await assertSucceeds(getDocs(collection(alice, 'verificationJobs/j1/events')));
    await assertFails(getDoc(doc(bob, 'verificationJobs/j1')));
    await assertFails(getDocs(collection(bob, 'verificationJobs/j1/events')));
    await assertFails(getDoc(doc(anon, 'verificationJobs/j1')));
    // Pipeline collections, verdicts and roles are server-only.
    await assertFails(getDoc(doc(alice, 'claims/c1')));
    await assertFails(setDoc(doc(alice, 'users/alice'), { role: 'admin' }));
    await assertFails(setDoc(doc(alice, 'verificationJobs/j1'), { userId: 'alice', status: 'completed' }));
    await assertFails(setDoc(doc(alice, 'judgeDecisions/x'), { verdict: 'CORRECT' }));
    await assertFails(setDoc(doc(alice, 'evidence/x'), { excerpt: 'made up' }));
  });
});
