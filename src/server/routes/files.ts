// Document upload (PART 6.4 / 8.1). Files go to Firebase Storage only; if
// Storage is not configured, upload is disabled with a setup message.
import express, { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { assertCanRead } from '../access';
import { requireAuth } from '../auth';
import { USAGE_LIMITS } from '../config';
import { detectType, extractContent, mimeOf } from '../documents/extract';
import { AppError } from '../errors';
import { bucket, db, storageStatus } from '../firebase';
import { handler, rateLimit } from '../http';
import { auditLog, today } from '../pipeline/jobs';
import { C, col, newId } from '../pipeline/store';

export const filesRouter = Router();
filesRouter.use(requireAuth, rateLimit);

async function consumeUploadQuota(uid: string) {
  const ref = col(C.users).doc(uid);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const u = (snap.get('usage') as { day: string; verifications: number; uploads: number } | undefined) ?? null;
    const sameDay = u?.day === today();
    const uploads = sameDay ? u!.uploads : 0;
    if (uploads >= USAGE_LIMITS.uploadsPerDay) {
      throw new AppError('USAGE_LIMIT', `Daily limit of ${USAGE_LIMITS.uploadsPerDay} uploads reached. Pasted text still works.`);
    }
    tx.set(ref, { usage: { day: today(), verifications: sameDay ? u!.verifications : 0, uploads: uploads + 1 } }, { merge: true });
  });
}

filesRouter.post(
  '/',
  (_req, _res, next) => {
    const s = storageStatus();
    next(s.configured ? undefined : new AppError('STORAGE_NOT_CONFIGURED', s.message ?? 'Document upload is disabled.'));
  },
  express.raw({ type: () => true, limit: USAGE_LIMITS.maxFileBytes }),
  handler(async (req) => {
    const user = req.user!;
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw new AppError('INVALID_INPUT', 'The file is empty.');
    const fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? 'document')).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'document';
    const type = detectType(buf, String(req.headers['content-type'] ?? ''), fileName);
    await consumeUploadQuota(user.uid);

    // Extract first: encrypted, corrupted or unsupported files are rejected and not stored.
    const extraction = await extractContent(buf, type);
    const fileId = newId();
    const storagePath = `users/${user.uid}/files/${fileId}/original`;
    await bucket().file(storagePath).save(buf, { contentType: mimeOf(type), resumable: false, metadata: { metadata: { ownerUid: user.uid, fileId } } });

    const usable = extraction.pages.filter((p) => p.status === 'extracted' || p.status === 'ocr');
    const batch = db().batch();
    batch.set(col(C.files).doc(fileId), {
      fileId,
      userId: user.uid,
      fileName,
      mimeType: mimeOf(type),
      sizeBytes: buf.length,
      storagePath,
      status: usable.length ? 'extracted' : 'failed',
      pageCount: extraction.pages.length,
      warnings: extraction.warnings,
      aiCalls: extraction.aiCalls,
      createdAtMs: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
    });
    for (const p of extraction.pages) {
      batch.set(col(C.extractionPages).doc(`${fileId}_p${p.pageNumber}`), {
        fileId,
        userId: user.uid,
        pageNumber: p.pageNumber,
        status: p.status,
        method: p.method,
        warning: p.warning,
        charCount: p.text.length,
        text: p.text,
      });
    }
    await batch.commit();
    await auditLog(user.uid, 'file_uploaded', fileId, { type, pages: extraction.pages.length });
    if (!usable.length) throw new AppError('CORRUPTED_FILE', 'No readable text could be extracted from this file.');
    return {
      fileId,
      fileName,
      text: usable.map((p) => p.text.trim()).join('\n\n'),
      pages: extraction.pages.map((p) => ({ pageNumber: p.pageNumber, status: p.status, warning: p.warning })),
      warnings: extraction.warnings,
    };
  }),
);

filesRouter.get(
  '/:fileId',
  handler(async (req) => {
    const snap = await col(C.files).doc(req.params.fileId!).get();
    const f = snap.data();
    // Teachers may see files submitted to their classroom (via the submission's classroomId).
    let classroomId: string | null = null;
    if (f && f.userId !== req.user!.uid) {
      const sub = await col(C.submissions).where('fileId', '==', req.params.fileId!).limit(1).get();
      classroomId = (sub.docs[0]?.get('classroomId') as string | null) ?? null;
    }
    await assertCanRead(f ? { userId: f.userId, classroomId } : null, req.user!);
    const pages = await col(C.extractionPages).where('fileId', '==', req.params.fileId!).get();
    return {
      ...f,
      storagePath: undefined,
      pages: pages.docs.map((d) => d.data()).sort((a, b) => a.pageNumber - b.pageNumber).map((p) => ({ pageNumber: p.pageNumber, status: p.status, method: p.method, warning: p.warning, charCount: p.charCount })),
    };
  }),
);

/** Ownership is checked before every download. */
filesRouter.get('/:fileId/download', async (req, res, next) => {
  try {
    const snap = await col(C.files).doc(req.params.fileId!).get();
    const f = snap.data();
    if (!f || f.userId !== req.user!.uid) throw new AppError('NOT_FOUND', 'Not found.');
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.fileName)}"`);
    bucket().file(f.storagePath).createReadStream().on('error', next).pipe(res);
  } catch (err) {
    next(err);
  }
});
