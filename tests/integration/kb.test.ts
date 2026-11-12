import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { db } from '../../src/server/firebase';
import { searchKb } from '../../src/server/kb/store';
import { apiClient, clearEmulators, createUser, drive, startServer, useGemini, type Api } from '../helpers/harness';
import { fakeEmbedding, fakeGemini } from '../helpers/fakeGemini';

const CLAIM = 'The orchard behind the school was planted with apricot trees in the year the school opened.';
// Pages that repeat the claim, so the test embedding finds them again later.
const fetchMock = vi.hoisted(() => ({ calls: 0, claim: '' }));
vi.mock('../../src/server/research/fetcher', async (orig) => {
  const real = await orig<typeof import('../../src/server/research/fetcher')>();
  return {
    ...real,
    fetchSource: async (url: string) => {
      fetchMock.calls++;
      const host = new URL(url).hostname;
      return { ok: true, requestedUrl: url, finalUrl: url, title: `Page at ${host}`, kind: 'html', pages: [{ page: null, text: `${fetchMock.claim} Reported by ${host.split('.')[0]}.` }] };
    },
  };
});

let server: Server;
let base: string;

beforeAll(async () => {
  ({ server, url: base } = await startServer());
});
afterAll(() => server.close());
beforeEach(async () => {
  await clearEmulators();
  fetchMock.calls = 0;
  fetchMock.claim = CLAIM;
});

async function user(email: string, role: 'student' | 'teacher' = 'student') {
  const u = await createUser(email);
  const api = apiClient(base, u.token);
  await api('GET', '/me');
  if (role !== 'student') await db().collection('users').doc(u.uid).update({ role });
  return { ...u, api };
}

async function upload(token: string, classroomId: string, name: string, text: string) {
  const res = await fetch(`${base}/api/classrooms/${classroomId}/materials`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain', 'X-File-Name': name },
    body: text,
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function verify(api: Api, assignmentId: string | null = null) {
  const { body } = await api('POST', '/verifications', { text: CLAIM, idempotencyKey: `k-${Math.random()}`, assignmentId });
  const awaiting = await drive(api, body.jobId);
  await api('POST', `/verifications/${body.jobId}/confirm`, { claims: awaiting.claims.map((c: any) => ({ claimId: c.claimId, selected: c.status !== 'not_verifiable' })) });
  return drive(api, body.jobId);
}

const evidenceOf = async (jobId: string) => (await db().collection('evidence').where('jobId', '==', jobId).get()).docs.map((d) => d.data());
const logKinds = async (jobId: string) => (await db().collection('researchLog').where('jobId', '==', jobId).get()).docs.map((d) => d.get('details')?.kind as string);
// Counted from the research log: searchCache is shared, so a repeated query may not reach Gemini at all.
const searches = async (jobId: string) => (await logKinds(jobId)).filter((k) => k === 'search' || k === 'search_failed').length;
const fetches = async (jobId: string) => (await logKinds(jobId)).filter((k) => k === 'fetched').length;

describe('public knowledge base: searched before the web', () => {
  it('reuses indexed pages for a stable claim, skipping the web searches and fetches', async () => {
    useGemini(fakeGemini());
    const a = await user('a@example.com');
    const job1 = await verify(a.api);
    expect(job1.job.status).toBe('completed');
    expect(await searches(job1.job.jobId)).toBeGreaterThan(0);
    expect(await fetches(job1.job.jobId)).toBeGreaterThan(0);
    expect((await db().collection('kbPublic').get()).size).toBeGreaterThan(0);

    // A different student asks the same thing: the stored passages answer it.
    useGemini(fakeGemini());
    const b = await user('b@example.com');
    const job2 = await verify(b.api);
    expect(job2.job.status).toBe('completed');
    expect(await searches(job2.job.jobId)).toBe(0);
    expect(await fetches(job2.job.jobId)).toBe(0);
    const ev = await evidenceOf(job2.job.jobId);
    expect(ev.some((e) => e.urlOrigin === 'knowledge_base' && e.provenanceStatus === 'quote_verified')).toBe(true);
    // The date shown is when the page was fetched, not today's lookup.
    expect(await logKinds(job2.job.jobId)).toContain('kb');
  });

  it('never uses stored public pages for time-sensitive claims', async () => {
    useGemini(fakeGemini());
    await verify((await user('a@example.com')).api);
    const g = fakeGemini({ timeSensitivity: 'time_sensitive' });
    useGemini(g);
    const job = await verify((await user('b@example.com')).api);
    expect(await searches(job.job.jobId)).toBeGreaterThan(0);
    expect(await logKinds(job.job.jobId)).not.toContain('kb');
    expect((await evidenceOf(job.job.jobId)).some((e) => e.urlOrigin === 'knowledge_base')).toBe(false);
  });

  it('ignores stored pages that are too old', async () => {
    useGemini(fakeGemini());
    await verify((await user('a@example.com')).api);
    const old = Date.now() - 200 * 24 * 3600_000;
    const snap = await db().collection('kbPublic').get();
    await Promise.all(snap.docs.map((d) => d.ref.update({ fetchedAtMs: old })));
    const g = fakeGemini();
    useGemini(g);
    const job = await verify((await user('b@example.com')).api);
    expect(await searches(job.job.jobId)).toBeGreaterThan(0);
  });

  it('falls back to the web when embedding fails', async () => {
    useGemini(fakeGemini());
    await verify((await user('a@example.com')).api);
    const g = fakeGemini();
    g.embed = async () => {
      throw new Error('embedding service down');
    };
    useGemini(g);
    const job = await verify((await user('b@example.com')).api);
    expect(job.job.status).toBe('completed');
    expect(await searches(job.job.jobId)).toBeGreaterThan(0);
  });
});

describe('teacher materials are private to their classroom', () => {
  async function setup() {
    useGemini(fakeGemini());
    const teacherA = await user('ta@example.com', 'teacher');
    const teacherB = await user('tb@example.com', 'teacher');
    const studentA = await user('sa@example.com');
    const studentB = await user('sb@example.com');
    const clsA = (await teacherA.api('POST', '/classrooms', { name: 'Class A', gradeLevel: 9 })).body;
    const clsB = (await teacherB.api('POST', '/classrooms', { name: 'Class B', gradeLevel: 9 })).body;
    await studentA.api('POST', '/classrooms/join', { inviteCode: clsA.inviteCode });
    await studentB.api('POST', '/classrooms/join', { inviteCode: clsB.inviteCode });
    const asgA = (await teacherA.api('POST', `/classrooms/${clsA.classroomId}/assignments`, { title: 'A task', instructions: 'Check it.' })).body;
    const asgB = (await teacherB.api('POST', `/classrooms/${clsB.classroomId}/assignments`, { title: 'B task', instructions: 'Check it.' })).body;
    return { teacherA, teacherB, studentA, studentB, clsA, clsB, asgA, asgB };
  }
  // The marker sentence comes first because the scripted assessor quotes a passage's first sentence.
  const SECRET = `The founding register of room ZEBRAFINCH confirms the planting. ${CLAIM}`;

  it('lets a classroom use its own materials and keeps every other classroom out', async () => {
    const t = await setup();
    const up = await upload(t.teacherA.token, t.clsA.classroomId, 'register.txt', SECRET);
    expect(up.status).toBe(200);
    expect(up.body.chunkCount).toBeGreaterThan(0);

    // Class A: the material is used as evidence, labelled as classroom material.
    const jobA = await verify(t.studentA.api, t.asgA.assignmentId);
    const evA = await evidenceOf(jobA.job.jobId);
    const fromMaterial = evA.filter((e) => e.urlOrigin === 'classroom_material');
    expect(fromMaterial.length).toBe(1);
    expect(fromMaterial[0]!.excerpt).toContain('ZEBRAFINCH');
    expect(fromMaterial[0]!.domain).toBe('classroom-material');

    // Class B and a student with no classroom never see it, anywhere it could have been written.
    const jobB = await verify(t.studentB.api, t.asgB.assignmentId);
    const loner = await user('loner@example.com');
    const jobC = await verify(loner.api);
    for (const jobId of [jobB.job.jobId, jobC.job.jobId]) {
      const dump = JSON.stringify([
        ...(await evidenceOf(jobId)),
        ...(await db().collection('agentAnalyses').where('jobId', '==', jobId).get()).docs.map((d) => d.data()),
        ...(await db().collection('researchLog').where('jobId', '==', jobId).get()).docs.map((d) => d.data()),
        ...(await db().collection('debateMessages').where('jobId', '==', jobId).get()).docs.map((d) => d.data()),
      ]);
      expect(dump).not.toContain('ZEBRAFINCH');
      expect(dump).not.toContain('classroom_material');
    }
  });

  it('never sends material text or titles to web search', async () => {
    const t = await setup();
    await upload(t.teacherA.token, t.clsA.classroomId, 'register-ZEBRAFINCH.txt', SECRET);
    const g = fakeGemini();
    useGemini(g);
    await verify(t.studentA.api, t.asgA.assignmentId);
    const outbound = g.calls.filter((c) => c.googleSearch || c.systemInstruction.includes('planning web searches')).map((c) => c.prompt).join('\n');
    expect(outbound).not.toContain('ZEBRAFINCH');
  });

  it('keeps the vector search itself scoped by classroom', async () => {
    const t = await setup();
    await upload(t.teacherA.token, t.clsA.classroomId, 'a.txt', SECRET);
    await upload(t.teacherB.token, t.clsB.classroomId, 'b.txt', `${CLAIM} Room PELICAN holds the other register.`);
    const q = fakeEmbedding(CLAIM);
    const a = await searchKb(q, { kind: 'classroom', classroomId: t.clsA.classroomId });
    const b = await searchKb(q, { kind: 'classroom', classroomId: t.clsB.classroomId });
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((h) => h.text.includes('ZEBRAFINCH') || !h.text.includes('PELICAN'))).toBe(true);
    expect(a.some((h) => h.text.includes('PELICAN'))).toBe(false);
    expect(b.some((h) => h.text.includes('ZEBRAFINCH'))).toBe(false);
    await expect(searchKb(q, { kind: 'classroom', classroomId: '' })).rejects.toThrow();
    // The public index does not contain classroom material.
    expect((await searchKb(q, { kind: 'public' })).some((h) => h.text.includes('ZEBRAFINCH'))).toBe(false);
  });

  it('only the classroom teacher can upload, list or delete materials', async () => {
    const t = await setup();
    expect((await upload(t.studentA.token, t.clsA.classroomId, 'x.txt', SECRET)).status).toBe(403);
    expect((await upload(t.teacherB.token, t.clsA.classroomId, 'x.txt', SECRET)).status).toBe(404);
    const up = await upload(t.teacherA.token, t.clsA.classroomId, 'a.txt', SECRET);
    expect((await t.studentA.api('GET', `/classrooms/${t.clsA.classroomId}/materials`)).status).toBe(403);
    expect((await t.teacherB.api('GET', `/classrooms/${t.clsA.classroomId}/materials`)).status).toBe(404);
    // Another teacher cannot delete it, not even through their own classroom's URL.
    expect((await t.teacherB.api('DELETE', `/classrooms/${t.clsB.classroomId}/materials/${up.body.materialId}`)).status).toBe(404);
    expect((await t.teacherB.api('DELETE', `/classrooms/${t.clsA.classroomId}/materials/${up.body.materialId}`)).status).toBe(404);
    expect((await db().collection('kbClassroom').get()).size).toBeGreaterThan(0);

    const list = await t.teacherA.api('GET', `/classrooms/${t.clsA.classroomId}/materials`);
    expect(list.body.items).toHaveLength(1);
    expect((await t.teacherA.api('DELETE', `/classrooms/${t.clsA.classroomId}/materials/${up.body.materialId}`)).status).toBe(200);
    expect((await db().collection('kbClassroom').get()).size).toBe(0);
    // Once removed, the material no longer reaches new investigations.
    const job = await verify(t.studentA.api, t.asgA.assignmentId);
    expect((await evidenceOf(job.job.jobId)).some((e) => e.urlOrigin === 'classroom_material')).toBe(false);
  });

  it('removes a half-indexed material when embedding fails', async () => {
    const t = await setup();
    const g = fakeGemini();
    g.embed = async () => {
      throw new Error('boom');
    };
    useGemini(g);
    const up = await upload(t.teacherA.token, t.clsA.classroomId, 'a.txt', SECRET);
    expect(up.status).toBeGreaterThanOrEqual(400);
    expect((await db().collection('classroomMaterials').get()).size).toBe(0);
    expect((await db().collection('kbClassroom').get()).size).toBe(0);
  });
});
