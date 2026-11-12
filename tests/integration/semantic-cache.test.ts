import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { db } from '../../src/server/firebase';
import { apiClient, clearEmulators, createUser, drive, fakeFetch, startServer, useGemini, type Api } from '../helpers/harness';
import { fakeGemini } from '../helpers/fakeGemini';

const fetchMock = vi.hoisted(() => ({ impl: null as null | ((u: string) => Promise<unknown>) }));
vi.mock('../../src/server/research/fetcher', async (orig) => {
  const real = await orig<typeof import('../../src/server/research/fetcher')>();
  return { ...real, fetchSource: (u: string) => fetchMock.impl!(u) };
});

// Two wordings of one claim (one word differs), and a pair that differs only in a number.
const BRIDGE = 'The old stone bridge across the river near the northern village was rebuilt by local masons after the great flood destroyed the original wooden crossing.';
const BRIDGE_REWORDED = BRIDGE.replace('wooden', 'timber');
const YEAR_1920 = 'The old stone bridge across the river near the northern village was rebuilt by local masons in 1920 after the great flood destroyed the original wooden crossing.';
const YEAR_1921 = YEAR_1920.replace('1920', '1921');

let server: Server;
let base: string;

beforeAll(async () => {
  ({ server, url: base } = await startServer());
});
afterAll(() => server.close());
beforeEach(async () => {
  await clearEmulators();
  // Default pages are unrelated to the claims, so the knowledge base never answers and these tests
  // exercise only the query caches.
  fetchMock.impl = fakeFetch() as never;
});

async function user(email: string) {
  const u = await createUser(email);
  const api = apiClient(base, u.token);
  await api('GET', '/me');
  return { ...u, api };
}

async function verify(api: Api, text: string, researchMode?: 'fast' | 'detailed') {
  const { body } = await api('POST', '/verifications', { text, idempotencyKey: `k-${Math.random()}`, ...(researchMode ? { researchMode } : {}) });
  const awaiting = await drive(api, body.jobId);
  await api('POST', `/verifications/${body.jobId}/confirm`, { claims: awaiting.claims.map((c: any) => ({ claimId: c.claimId, selected: c.status !== 'not_verifiable' })) });
  return drive(api, body.jobId);
}

const logs = async (jobId: string) => (await db().collection('researchLog').where('jobId', '==', jobId).get()).docs.map((d) => d.get('details') as Record<string, any>);
const planner = (g: ReturnType<typeof fakeGemini>) => g.count('planning web searches');
const webSearches = (g: ReturnType<typeof fakeGemini>) => g.calls.filter((c) => c.googleSearch).length;

describe('fast research mode reuses work from similar earlier questions', () => {
  it('skips the planner and the web search for a reworded claim', async () => {
    useGemini(fakeGemini());
    await verify((await user('a@example.com')).api, BRIDGE); // omitted mode = detailed; it fills the caches

    const g = fakeGemini();
    useGemini(g);
    const job = await verify((await user('b@example.com')).api, BRIDGE_REWORDED, 'fast');
    expect(job.job.status).toBe('completed');
    expect(planner(g)).toBe(0);
    expect(webSearches(g)).toBe(0);
    const l = await logs(job.job.jobId);
    expect(l.some((d) => d.kind === 'plan_cached')).toBe(true);
    // Reused queries are the very same strings, so the existing exact cache answers them.
    const searches = l.filter((d) => d.kind === 'search');
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every((d) => d.cached === true)).toBe(true);
  });

  it('reuses saved searches for reworded queries when no plan is cached', async () => {
    useGemini(fakeGemini());
    await verify((await user('a@example.com')).api, BRIDGE);
    // Without a stored plan the planner runs and writes new queries, worded differently from the saved ones.
    for (const d of (await db().collection('planCache').get()).docs) await d.ref.delete();

    const g = fakeGemini();
    useGemini(g);
    const job = await verify((await user('b@example.com')).api, BRIDGE_REWORDED, 'fast');
    expect(job.job.status).toBe('completed');
    expect(planner(g)).toBeGreaterThan(0);
    expect(webSearches(g)).toBe(0);
    const searches = (await logs(job.job.jobId)).filter((d) => d.kind === 'search');
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every((d) => d.semantic === true && d.matchedQuery)).toBe(true);
  });

  it('detailed mode plans and searches afresh even when a similar claim exists', async () => {
    useGemini(fakeGemini());
    await verify((await user('a@example.com')).api, BRIDGE);

    const g = fakeGemini();
    useGemini(g);
    const job = await verify((await user('b@example.com')).api, BRIDGE_REWORDED, 'detailed');
    expect(planner(g)).toBeGreaterThan(0);
    const l = await logs(job.job.jobId);
    expect(l.some((d) => d.kind === 'plan_cached')).toBe(false);
    expect(l.filter((d) => d.kind === 'search').some((d) => d.semantic)).toBe(false);
  });

  it('does not reuse work when the claims differ in a number', async () => {
    useGemini(fakeGemini());
    await verify((await user('a@example.com')).api, YEAR_1920);

    const g = fakeGemini();
    useGemini(g);
    const job = await verify((await user('b@example.com')).api, YEAR_1921, 'fast');
    expect(planner(g)).toBeGreaterThan(0);
    const l = await logs(job.job.jobId);
    expect(l.some((d) => d.kind === 'plan_cached')).toBe(false);
    expect(l.filter((d) => d.kind === 'search').some((d) => d.semantic)).toBe(false);
  });

  it('a deeper investigation never uses the semantic caches, even after a fast run', async () => {
    useGemini(fakeGemini());
    await verify((await user('a@example.com')).api, BRIDGE);

    useGemini(fakeGemini());
    const b = await user('b@example.com');
    const fast = await verify(b.api, BRIDGE_REWORDED, 'fast');
    expect((await logs(fast.job.jobId)).some((d) => d.kind === 'plan_cached')).toBe(true);

    const g = fakeGemini();
    useGemini(g);
    const claimId = fast.job.claimSummaries[0].claimId;
    const deeper = await b.api('POST', `/verifications/${fast.job.jobId}/claims/${claimId}/deeper`);
    expect(deeper.status).toBe(200);
    const done = await drive(b.api, deeper.body.jobId);
    expect(done.job.status).toBe('completed');
    expect(planner(g)).toBeGreaterThan(0);
    const l = await logs(deeper.body.jobId);
    expect(l.some((d) => d.kind === 'plan_cached')).toBe(false);
    expect(l.filter((d) => d.kind === 'search').some((d) => d.semantic)).toBe(false);
    expect((await db().collection('verificationJobs').doc(deeper.body.jobId).get()).get('researchMode')).toBe('detailed');
  });

  it('the plan cache stores no claim text', async () => {
    useGemini(fakeGemini());
    await verify((await user('a@example.com')).api, YEAR_1920);
    const snap = await db().collection('planCache').get();
    expect(snap.size).toBe(1);
    // Planned queries are stored (they go to a web search anyway); the claim itself is not.
    expect(Object.keys(snap.docs[0]!.data()).sort()).toEqual(['createdAtMs', 'embedding', 'language', 'numbers', 'queries']);
    expect(snap.docs[0]!.get('numbers')).toBe('1920');
  });
});
