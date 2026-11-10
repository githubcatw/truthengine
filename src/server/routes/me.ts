import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { UpdateProfileSchema } from '../../shared/api';
import { requireAuth } from '../auth';
import { handler, parse } from '../http';
import { C, col } from '../pipeline/store';

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get(
  '/',
  handler(async (req) => {
    const snap = await col(C.users).doc(req.user!.uid).get();
    const d = snap.data()!;
    return {
      uid: d.uid,
      email: d.email,
      displayName: d.displayName ?? null,
      role: d.role,
      preferredLanguage: d.preferredLanguage,
      gradeLevel: d.gradeLevel ?? null,
      accountStatus: d.accountStatus,
    };
  }),
);

// Users may edit their profile; `role` and `accountStatus` are not accepted here (server-controlled).
meRouter.patch(
  '/',
  handler(async (req) => {
    const body = parse(UpdateProfileSchema.strict(), req.body);
    await col(C.users).doc(req.user!.uid).update({ ...body, updatedAt: FieldValue.serverTimestamp() });
    return { ok: true };
  }),
);
