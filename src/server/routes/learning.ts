import { Router } from 'express';
import { orderedQuery } from '../firestoreQuery';
import { z } from 'zod';
import { ExerciseAnswerSchema } from '../../shared/api';
import { requireAuth } from '../auth';
import { AppError } from '../errors';
import { db } from '../firebase';
import { handler, parse, rateLimit } from '../http';
import { C, col } from '../pipeline/store';

export const learningRouter = Router();
learningRouter.use(['/exercises', '/learning'], requireAuth, rateLimit);

/** The student's own exercises (generated from their real verifications). */
learningRouter.get(
  '/exercises',
  handler(async (req) => {
    const { cursor, limit } = parse(z.object({ cursor: z.coerce.number().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
    const rows = await orderedQuery({
      name: 'learningExercises by user',
      base: col(C.exercises).where('userId', '==', req.user!.uid),
      orderBy: 'createdAtMs',
      direction: 'desc',
      limit,
      after: cursor,
    });
    const items = rows.map((e) => (e.attempt ? e : { ...e, correctIndex: undefined }));
    return { items, nextCursor: items.length === limit ? (items.at(-1)!.createdAtMs as number) : null };
  }),
);

learningRouter.post(
  '/exercises/:exerciseId/answer',
  handler(async (req) => {
    const { selectedIndex } = parse(ExerciseAnswerSchema, req.body);
    const ref = col(C.exercises).doc(req.params.exerciseId!);
    const profileRef = col(C.profiles).doc(req.user!.uid);
    return db().runTransaction(async (tx) => {
      const [snap, profile] = await Promise.all([tx.get(ref), tx.get(profileRef)]);
      const ex = snap.data();
      if (!ex || ex.userId !== req.user!.uid) throw new AppError('NOT_FOUND', 'Not found.');
      if (ex.attempt) return { correct: ex.attempt.correct, correctIndex: ex.correctIndex, explanation: ex.explanation };
      if (selectedIndex >= ex.options.length) throw new AppError('INVALID_INPUT', 'Invalid option.');
      const correct = selectedIndex === ex.correctIndex;
      tx.update(ref, { attempt: { selectedIndex, correct, atMs: Date.now() } });
      const p = profile.data() ?? { exercisesAnswered: 0, exercisesCorrect: 0 };
      tx.set(profileRef, {
        uid: req.user!.uid,
        exercisesAnswered: (p.exercisesAnswered ?? 0) + 1,
        exercisesCorrect: (p.exercisesCorrect ?? 0) + (correct ? 1 : 0),
        lastActivityAtMs: Date.now(),
      });
      return { correct, correctIndex: ex.correctIndex, explanation: ex.explanation };
    });
  }),
);

learningRouter.get(
  '/learning/progress',
  handler(async (req) => {
    const snap = await col(C.profiles).doc(req.user!.uid).get();
    return snap.data() ?? { uid: req.user!.uid, exercisesAnswered: 0, exercisesCorrect: 0, lastActivityAtMs: null };
  }),
);
