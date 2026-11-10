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

const TEXT = 'The orchard behind the school was planted with apricot trees in the year the school opened.';
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

async function userWithRole(email: string, role: 'student' | 'teacher' | 'admin') {
  const u = await createUser(email);
  const api = apiClient(base, u.token);
  await api('GET', '/me');
  if (role !== 'student') await db().collection('users').doc(u.uid).update({ role });
  return { ...u, api };
}

async function verify(api: Api, extra: Record<string, unknown> = {}) {
  const { body } = await api('POST', '/verifications', { text: TEXT, idempotencyKey: `k-${Math.random()}`, ...extra });
  const awaiting = await drive(api, body.jobId);
  await api('POST', `/verifications/${body.jobId}/confirm`, { claims: awaiting.claims.map((c: any) => ({ claimId: c.claimId, selected: c.status !== 'not_verifiable' })) });
  return drive(api, body.jobId);
}

describe('classrooms, assignments and teacher authorization', () => {
  it('teacher review is limited to submissions made to their classroom', async () => {
    const teacher = await userWithRole('t@example.com', 'teacher');
    const otherTeacher = await userWithRole('t2@example.com', 'teacher');
    const student = await userWithRole('s@example.com', 'student');

    // Students cannot create classrooms.
    expect((await student.api('POST', '/classrooms', { name: 'Mine', gradeLevel: 9 })).status).toBe(403);
    const cls = (await teacher.api('POST', '/classrooms', { name: 'History 9A', gradeLevel: 9 })).body;
    expect(cls.inviteCode).toMatch(/^[A-Z2-9]{8}$/);
    const join = await student.api('POST', '/classrooms/join', { inviteCode: cls.inviteCode });
    expect(join.status).toBe(200);
    const asg = (await teacher.api('POST', `/classrooms/${cls.classroomId}/assignments`, { title: 'Check one fact', instructions: 'Verify a claim from the textbook.' })).body;
    expect((await student.api('POST', `/classrooms/${cls.classroomId}/assignments`, { title: 'x' })).status).toBe(403);

    const assigned = await verify(student.api, { assignmentId: asg.assignmentId });
    const privateJob = await verify(student.api);
    const claimId = assigned.job.claimSummaries[0].claimId;

    // Teacher sees the assignment submission (read only), not the private one.
    const subs = (await teacher.api('GET', `/classrooms/${cls.classroomId}/submissions`)).body.items;
    expect(subs.map((s: any) => s.jobId)).toEqual([assigned.job.jobId]);
    const view = await teacher.api('GET', `/verifications/${assigned.job.jobId}`);
    expect(view.status).toBe(200);
    expect(view.body.readOnly).toBe(true);
    expect((await teacher.api('GET', `/claims/${claimId}`)).body.readOnly).toBe(true);
    expect((await teacher.api('POST', `/verifications/${assigned.job.jobId}/advance`)).status).toBe(404);
    expect((await teacher.api('GET', `/verifications/${privateJob.job.jobId}`)).status).toBe(404);

    // Another teacher sees nothing.
    expect((await otherTeacher.api('GET', `/classrooms/${cls.classroomId}/submissions`)).status).toBe(404);
    expect((await otherTeacher.api('GET', `/verifications/${assigned.job.jobId}`)).status).toBe(404);
    expect((await otherTeacher.api('GET', `/claims/${claimId}`)).status).toBe(404);

    // Students cannot see insights; the teacher can.
    expect((await student.api('GET', `/classrooms/${cls.classroomId}/insights`)).status).toBe(403);
    const insights = (await teacher.api('GET', `/classrooms/${cls.classroomId}/insights`)).body;
    expect(insights.progress[0].submissions).toBe(1);

    // The student sees their own submission on the assignment; invite codes are hidden from students.
    const a = (await student.api('GET', `/assignments/${asg.assignmentId}`)).body;
    expect(a.mySubmissions).toHaveLength(1);
    const listed = (await student.api('GET', '/classrooms')).body.joined[0];
    expect(listed.inviteCode).toBeUndefined();
  });

  it('exercises reveal the answer only after answering and update progress once', async () => {
    const student = await userWithRole('ex@example.com', 'student');
    const done = await verify(student.api);
    const list = (await student.api('GET', '/exercises')).body.items;
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].correctIndex).toBeUndefined();
    const ans = await student.api('POST', `/exercises/${list[0].exerciseId}/answer`, { selectedIndex: 0 });
    expect(ans.body).toMatchObject({ correct: true, correctIndex: 0 });
    await student.api('POST', `/exercises/${list[0].exerciseId}/answer`, { selectedIndex: 1 });
    const progress = (await student.api('GET', '/learning/progress')).body;
    expect(progress).toMatchObject({ exercisesAnswered: 1, exercisesCorrect: 1 });
    expect(done.job.status).toBe('completed');
  });
});

describe('administration, trusted sources, receipts, notifications, PDF', () => {
  it('only administrators grant roles and manage trusted sources', async () => {
    const admin = await userWithRole('admin@example.com', 'admin');
    const student = await userWithRole('stu@example.com', 'student');
    expect((await student.api('PATCH', `/admin/users/${student.uid}/role`, { role: 'teacher' })).status).toBe(403);
    expect((await student.api('GET', '/admin/performance')).status).toBe(403);
    expect((await admin.api('PATCH', `/admin/users/${student.uid}/role`, { role: 'teacher' })).status).toBe(200);
    expect((await student.api('GET', '/me')).body.role).toBe('teacher');
    expect((await admin.api('PATCH', `/admin/users/${admin.uid}/role`, { role: 'student' })).status).toBe(409);

    const src = { name: 'National Library', url: 'https://nla.example.am', subjects: ['armenian_history'], gradeLevels: [9], reliabilityDescription: 'National library catalogue.', verificationStatus: 'unverified' };
    expect((await student.api('POST', '/sources', src)).status).toBe(403);
    expect((await admin.api('POST', '/sources', src)).status).toBe(200);
    expect((await student.api('GET', '/sources')).body.items).toHaveLength(1);
    const perf = (await admin.api('GET', '/admin/performance')).body;
    expect(Array.isArray(perf.stages)).toBe(true);
    const settings = (await admin.api('GET', '/admin/settings')).body;
    expect(JSON.stringify(settings)).not.toMatch(/GEMINI_API_KEY|AIza/);
  });

  it('a registry match is recorded on evidence but never decides the verdict', async () => {
    const admin = await userWithRole('admin2@example.com', 'admin');
    await admin.api('POST', '/sources', { name: 'Alpha University', url: 'https://alpha.example.edu', subjects: ['world_history'], gradeLevels: [], reliabilityDescription: 'University press.', verificationStatus: 'verified_by_admin' });
    const done = await verify(admin.api);
    const report = (await admin.api('GET', `/claims/${done.job.claimSummaries[0].claimId}`)).body;
    const alpha = report.evidence.find((e: any) => e.domain === 'alpha.example.edu');
    expect(alpha.trustedSource).toMatchObject({ name: 'Alpha University', verificationStatus: 'verified_by_admin' });
    expect(alpha.urlOrigin).toBe('fetched_page');
  });

  it('receipts detect later changes; notifications and PDF reports work', async () => {
    const u = await userWithRole('r@example.com', 'student');
    const done = await verify(u.api);
    const claimId = done.job.claimSummaries[0].claimId;
    const receipt = (await u.api('POST', '/receipts', { claimId })).body;
    expect(receipt.hash).toMatch(/^[a-f0-9]{64}$/);
    expect((await u.api('GET', `/receipts/${receipt.receiptId}/verify`)).body.intact).toBe(true);
    await db().collection('evidence').doc(`${claimId}_E1`).update({ excerpt: 'altered text' });
    expect((await u.api('GET', `/receipts/${receipt.receiptId}/verify`)).body.intact).toBe(false);

    const notes = (await u.api('GET', '/notifications')).body.items;
    expect(notes[0]).toMatchObject({ type: 'verification_finished', status: 'completed', read: false });
    expect((await u.api('GET', '/notifications/unread-count')).body.unread).toBe(1);
    await u.api('POST', `/notifications/${notes[0].notificationId}/read`);
    expect((await u.api('GET', '/notifications/unread-count')).body.unread).toBe(0);

    await u.api('PATCH', '/me', { preferredLanguage: 'hy' });
    const pdfRes = await fetch(`${base}/api/reports/${claimId}.pdf`, { headers: { Authorization: `Bearer ${u.token}` } });
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf');
    const bytes = Buffer.from(await pdfRes.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(5000); // fonts embedded

    const other = await userWithRole('r2@example.com', 'student');
    expect((await fetch(`${base}/api/reports/${claimId}.pdf`, { headers: { Authorization: `Bearer ${other.token}` } })).status).toBe(404);
    expect((await other.api('POST', '/receipts', { claimId })).status).toBe(404);
  });
});
