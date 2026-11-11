// Classrooms, invitations, assignments and teacher review (PART 16, Phase 3).
// Server-side classroom authorization on every route (PART 6.2).
import { randomBytes } from 'node:crypto';
import { orderedQuery } from '../firestoreQuery';
import { Router } from 'express';
import { AssignmentCreateSchema, ClassroomCreateSchema, JoinClassroomSchema } from '../../shared/api';
import { requireAuth, requireRole, type AuthedUser } from '../auth';
import { AppError } from '../errors';
import { db } from '../firebase';
import { handler, parse, rateLimit } from '../http';
import { auditLog } from '../pipeline/jobs';
import { C, col, newId } from '../pipeline/store';
import type { JobDoc } from '../pipeline/types';

export const classroomsRouter = Router();
classroomsRouter.use(['/classrooms', '/assignments'], requireAuth, rateLimit);

interface Classroom {
  classroomId: string;
  name: string;
  gradeLevel: number | null;
  teacherId: string;
  teacherName: string | null;
  inviteCode: string;
  createdAtMs: number;
}

const inviteCode = () =>
  Array.from(randomBytes(8))
    .map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32])
    .join('');

async function loadClassroom(id: string, user: AuthedUser): Promise<{ classroom: Classroom; isTeacher: boolean }> {
  const snap = await col(C.classrooms).doc(id).get();
  const classroom = snap.data() as Classroom | undefined;
  if (!classroom) throw new AppError('NOT_FOUND', 'Not found.');
  if (classroom.teacherId === user.uid) return { classroom, isTeacher: true };
  const member = await col(C.members).doc(`${id}_${user.uid}`).get();
  if (!member.exists) throw new AppError('NOT_FOUND', 'Not found.');
  return { classroom, isTeacher: false };
}

async function requireTeacherOf(id: string, user: AuthedUser): Promise<Classroom> {
  const { classroom, isTeacher } = await loadClassroom(id, user);
  if (!isTeacher) throw new AppError('FORBIDDEN', 'Only the classroom teacher can do this.');
  return classroom;
}

classroomsRouter.get(
  '/classrooms',
  handler(async (req) => {
    const uid = req.user!.uid;
    const [teaching, memberships] = await Promise.all([
      col(C.classrooms).where('teacherId', '==', uid).get(),
      col(C.members).where('userId', '==', uid).get(),
    ]);
    const joinedIds = memberships.docs.map((d) => d.get('classroomId') as string);
    const joined = joinedIds.length ? await db().getAll(...joinedIds.map((id) => col(C.classrooms).doc(id))) : [];
    const strip = (c: Classroom, isTeacher: boolean) => ({ ...c, inviteCode: isTeacher ? c.inviteCode : undefined, isTeacher });
    return {
      teaching: teaching.docs.map((d) => strip(d.data() as Classroom, true)),
      joined: joined.filter((d) => d.exists).map((d) => strip(d.data() as Classroom, false)),
    };
  }),
);

classroomsRouter.post(
  '/classrooms',
  requireRole('teacher', 'admin'),
  handler(async (req) => {
    const body = parse(ClassroomCreateSchema, req.body);
    const classroomId = newId();
    const c: Classroom = {
      classroomId,
      name: body.name,
      gradeLevel: body.gradeLevel,
      teacherId: req.user!.uid,
      teacherName: req.user!.displayName,
      inviteCode: inviteCode(),
      createdAtMs: Date.now(),
    };
    await col(C.classrooms).doc(classroomId).set(c);
    await auditLog(req.user!.uid, 'classroom_created', classroomId);
    return c;
  }),
);

classroomsRouter.post(
  '/classrooms/join',
  handler(async (req) => {
    const { inviteCode: code } = parse(JoinClassroomSchema, req.body);
    const snap = await col(C.classrooms).where('inviteCode', '==', code.toUpperCase()).limit(1).get();
    const c = snap.docs[0]?.data() as Classroom | undefined;
    if (!c) throw new AppError('NOT_FOUND', 'No classroom has this invite code.');
    if (c.teacherId === req.user!.uid) throw new AppError('CONFLICT', 'You teach this classroom.');
    await col(C.members).doc(`${c.classroomId}_${req.user!.uid}`).set({
      classroomId: c.classroomId,
      userId: req.user!.uid,
      displayName: req.user!.displayName ?? req.user!.email,
      joinedAtMs: Date.now(),
    });
    await auditLog(req.user!.uid, 'classroom_joined', c.classroomId);
    return { classroomId: c.classroomId, name: c.name };
  }),
);

classroomsRouter.get(
  '/classrooms/:id',
  handler(async (req) => {
    const { classroom, isTeacher } = await loadClassroom(req.params.id!, req.user!);
    const [assignments, members] = await Promise.all([
      col(C.assignments).where('classroomId', '==', classroom.classroomId).get(),
      isTeacher ? col(C.members).where('classroomId', '==', classroom.classroomId).get() : null,
    ]);
    return {
      classroom: { ...classroom, inviteCode: isTeacher ? classroom.inviteCode : undefined },
      isTeacher,
      assignments: assignments.docs.map((d) => d.data()).sort((a, b) => b.createdAtMs - a.createdAtMs),
      members: members ? members.docs.map((d) => d.data()) : null,
    };
  }),
);

classroomsRouter.delete(
  '/classrooms/:id/members/:uid',
  handler(async (req) => {
    await requireTeacherOf(req.params.id!, req.user!);
    await col(C.members).doc(`${req.params.id}_${req.params.uid}`).delete();
    return { ok: true };
  }),
);

classroomsRouter.post(
  '/classrooms/:id/assignments',
  handler(async (req) => {
    const classroom = await requireTeacherOf(req.params.id!, req.user!);
    const body = parse(AssignmentCreateSchema, req.body);
    const assignmentId = newId();
    const a = { assignmentId, classroomId: classroom.classroomId, teacherId: req.user!.uid, ...body, createdAtMs: Date.now() };
    await col(C.assignments).doc(assignmentId).set(a);
    return a;
  }),
);

classroomsRouter.get(
  '/assignments/:id',
  handler(async (req) => {
    const snap = await col(C.assignments).doc(req.params.id!).get();
    const a = snap.data();
    if (!a) throw new AppError('NOT_FOUND', 'Not found.');
    const { isTeacher } = await loadClassroom(a.classroomId, req.user!);
    let mySubmissions: unknown[] = [];
    if (!isTeacher) {
      const jobs = await col(C.jobs).where('userId', '==', req.user!.uid).where('assignmentId', '==', a.assignmentId).get();
      mySubmissions = jobs.docs.map((d) => d.data() as JobDoc).filter((j) => j.status !== 'superseded').map((j) => ({ jobId: j.jobId, status: j.status, claimSummaries: j.claimSummaries, startedAtMs: j.startedAtMs }));
    }
    return { ...a, isTeacher, mySubmissions };
  }),
);

/** Authorized submission review: only jobs submitted to this classroom. */
classroomsRouter.get(
  '/classrooms/:id/submissions',
  handler(async (req) => {
    await requireTeacherOf(req.params.id!, req.user!);
    const rows = await orderedQuery({ name: 'verificationJobs by classroom', base: col(C.jobs).where('classroomId', '==', req.params.id!), orderBy: 'startedAtMs', direction: 'desc', limit: 100 });
    const jobs = (rows as JobDoc[]).filter((j) => j.status !== 'superseded');
    const uids = [...new Set(jobs.map((j) => j.userId))];
    const users = uids.length ? await db().getAll(...uids.map((u) => col(C.users).doc(u))) : [];
    const names = new Map(users.map((u) => [u.id, (u.get('displayName') as string | null) ?? (u.get('email') as string | null)]));
    return {
      items: jobs.map((j) => ({
        jobId: j.jobId,
        userId: j.userId,
        studentName: names.get(j.userId) ?? null,
        assignmentId: j.assignmentId,
        status: j.status,
        startedAtMs: j.startedAtMs,
        claimSummaries: j.claimSummaries,
      })),
    };
  }),
);

/** Misconception analysis and progress, built from stored results only. */
classroomsRouter.get(
  '/classrooms/:id/insights',
  handler(async (req) => {
    await requireTeacherOf(req.params.id!, req.user!);
    const [jobSnap, memberSnap] = await Promise.all([
      orderedQuery({ name: 'verificationJobs by classroom', base: col(C.jobs).where('classroomId', '==', req.params.id!), orderBy: 'startedAtMs', direction: 'desc', limit: 300 }),
      col(C.members).where('classroomId', '==', req.params.id!).get(),
    ]);
    const jobs = (jobSnap as JobDoc[]).filter((j) => j.status !== 'superseded');
    const wrongIds = jobs.flatMap((j) => j.claimSummaries.filter((c) => c.verdict === 'WRONG').map((c) => c.claimId));
    const results = wrongIds.length ? await db().getAll(...wrongIds.slice(0, 200).map((id) => col(C.results).doc(id))) : [];
    const bySubject: Record<string, Array<{ claimId: string; topicStatement: string; verdictBasis: string; userId: string }>> = {};
    for (const r of results) {
      if (!r.exists) continue;
      const d = r.data()!;
      (bySubject[d.subject] ??= []).push({ claimId: d.claimId, topicStatement: d.topicStatement, verdictBasis: d.verdictBasis, userId: d.userId });
    }
    const members = memberSnap.docs.map((d) => d.data());
    const profiles = members.length ? await db().getAll(...members.map((m) => col(C.profiles).doc(m.userId))) : [];
    const progress = members.map((m, i) => ({
      userId: m.userId,
      displayName: m.displayName,
      submissions: jobs.filter((j) => j.userId === m.userId).length,
      exercisesAnswered: (profiles[i]?.get('exercisesAnswered') as number | undefined) ?? 0,
      exercisesCorrect: (profiles[i]?.get('exercisesCorrect') as number | undefined) ?? 0,
    }));
    return { misconceptions: bySubject, progress };
  }),
);
