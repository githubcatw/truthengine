// Server-side read authorization for user-owned records (PART 6.2): the owner,
// or a teacher of the classroom the record was submitted to.
import type { AuthedUser } from './auth';
import { AppError } from './errors';
import { C, col } from './pipeline/store';

export async function isTeacherOf(user: AuthedUser, classroomId: string | null | undefined): Promise<boolean> {
  if (!classroomId || (user.role !== 'teacher' && user.role !== 'admin')) return false;
  const snap = await col(C.classrooms).doc(classroomId).get();
  return snap.exists && snap.get('teacherId') === user.uid;
}

/** Throws NOT_FOUND (never FORBIDDEN) so record existence is not leaked. */
export async function assertCanRead(
  record: { userId?: string; classroomId?: string | null } | undefined | null,
  user: AuthedUser,
): Promise<{ asTeacher: boolean }> {
  if (!record) throw new AppError('NOT_FOUND', 'Not found.');
  if (record.userId === user.uid) return { asTeacher: false };
  if (await isTeacherOf(user, record.classroomId)) return { asTeacher: true };
  throw new AppError('NOT_FOUND', 'Not found.');
}

export async function loadJobForRead(jobId: string, user: AuthedUser) {
  const snap = await col(C.jobs).doc(jobId).get();
  const job = snap.data() as { userId: string; classroomId: string | null } | undefined;
  const access = await assertCanRead(job, user);
  return { job: job!, ...access };
}
