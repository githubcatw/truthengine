// Server-side authentication and authorization (PART 6.2). Frontend route
// guards are convenience only; every protected route goes through here.
import type { NextFunction, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { bootstrapAdminEmails } from './config';
import { AppError } from './errors';
import { adminAuth, db } from './firebase';
import type { Language, Role } from '../shared/schemas';

export interface AuthedUser {
  uid: string;
  email: string | null;
  role: Role;
  displayName: string | null;
  preferredLanguage: Language;
  gradeLevel: number | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
  }
}

/** Loads the user's document, creating it on first sign-in. New users are always `student`. */
export async function loadOrCreateUser(uid: string, email: string | null, emailVerified: boolean, name: string | null) {
  const ref = db().collection('users').doc(uid);
  const isBootstrapAdmin = Boolean(email && emailVerified && bootstrapAdminEmails().includes(email.toLowerCase()));

  const data = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const doc = {
        uid,
        email,
        displayName: name,
        role: (isBootstrapAdmin ? 'admin' : 'student') as Role,
        preferredLanguage: 'hy' as Language,
        gradeLevel: null,
        accountStatus: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.set(ref, doc);
      return doc;
    }
    const existing = snap.data()!;
    if (isBootstrapAdmin && existing.role !== 'admin') {
      tx.update(ref, { role: 'admin', updatedAt: FieldValue.serverTimestamp() });
      return { ...existing, role: 'admin' };
    }
    return existing;
  });

  // Keep the custom claim in sync with the server-controlled role.
  if (isBootstrapAdmin) await adminAuth().setCustomUserClaims(uid, { role: 'admin' });
  return data;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.user) return next(); // already verified by an earlier router on this request
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
    let decoded;
    try {
      decoded = await adminAuth().verifyIdToken(token);
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    }
    const user = await loadOrCreateUser(
      decoded.uid,
      decoded.email ?? null,
      Boolean(decoded.email_verified),
      (decoded.name as string | undefined) ?? null,
    );
    if (user.accountStatus === 'suspended') throw new AppError('FORBIDDEN', 'This account is suspended.');
    req.user = {
      uid: decoded.uid,
      email: decoded.email ?? null,
      role: user.role,
      displayName: user.displayName ?? null,
      preferredLanguage: user.preferredLanguage ?? 'hy',
      gradeLevel: user.gradeLevel ?? null,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('UNAUTHENTICATED', 'Please sign in.'));
    if (!roles.includes(req.user.role)) return next(new AppError('FORBIDDEN', 'You do not have permission for this action.'));
    next();
  };
}

/** Ownership check for any user-owned record. Returns "Not found" so existence is not leaked. */
export function assertOwner(record: { userId?: string } | undefined | null, user: AuthedUser): asserts record {
  if (!record || record.userId !== user.uid) throw new AppError('NOT_FOUND', 'Not found.');
}
