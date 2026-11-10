// Trusted sources, receipts, notifications and administration (Phase 4).
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { SetAccountStatusSchema, SetRoleSchema, TrustedSourceSchema } from '../../shared/api';
import { requireAuth, requireRole } from '../auth';
import { AUDIT, CACHE_TTL_MS, MODELS, PIPELINE, RESEARCH, RESEARCH_BUDGETS, USAGE_LIMITS } from '../config';
import { AppError } from '../errors';
import { adminAuth, db } from '../firebase';
import { handler, parse, rateLimit } from '../http';
import { auditLog } from '../pipeline/jobs';
import { C, col, newId } from '../pipeline/store';
import { invalidateTrustedSources } from '../research/registry';

export const platformRouter = Router();
platformRouter.use(['/sources', '/receipts', '/notifications', '/admin'], requireAuth, rateLimit);

// ---------------------------------------------------------------------------
// Trusted sources registry (separate from retrieved evidence)
// ---------------------------------------------------------------------------
platformRouter.get(
  '/sources',
  handler(async () => {
    const snap = await col(C.trustedSources).orderBy('name').limit(500).get();
    return { items: snap.docs.map((d) => d.data()) };
  }),
);

platformRouter.post(
  '/sources',
  requireRole('admin'),
  handler(async (req) => {
    const body = parse(TrustedSourceSchema, req.body);
    const sourceId = newId();
    const doc = { sourceId, ...body, host: new URL(body.url).hostname.replace(/^www\./, '').toLowerCase(), createdBy: req.user!.uid, updatedAtMs: Date.now() };
    await col(C.trustedSources).doc(sourceId).set(doc);
    invalidateTrustedSources();
    await auditLog(req.user!.uid, 'trusted_source_added', sourceId);
    return doc;
  }),
);

platformRouter.put(
  '/sources/:id',
  requireRole('admin'),
  handler(async (req) => {
    const body = parse(TrustedSourceSchema, req.body);
    const ref = col(C.trustedSources).doc(req.params.id!);
    if (!(await ref.get()).exists) throw new AppError('NOT_FOUND', 'Not found.');
    await ref.update({ ...body, host: new URL(body.url).hostname.replace(/^www\./, '').toLowerCase(), updatedAtMs: Date.now() });
    invalidateTrustedSources();
    await auditLog(req.user!.uid, 'trusted_source_updated', req.params.id!);
    return { ok: true };
  }),
);

platformRouter.delete(
  '/sources/:id',
  requireRole('admin'),
  handler(async (req) => {
    await col(C.trustedSources).doc(req.params.id!).delete();
    invalidateTrustedSources();
    await auditLog(req.user!.uid, 'trusted_source_removed', req.params.id!);
    return { ok: true };
  }),
);

// ---------------------------------------------------------------------------
// Verification receipts: a SHA-256 fingerprint of the stored result
// ---------------------------------------------------------------------------
async function fingerprint(claimId: string): Promise<{ hash: string; verdict: string; topicStatement: string; jobId: string; userId: string }> {
  const [result, decision, evidence] = await Promise.all([
    col(C.results).doc(claimId).get(),
    col(C.decisions).doc(`${claimId}_judge`).get(),
    col(C.evidence).where('claimId', '==', claimId).get(),
  ]);
  if (!result.exists || !decision.exists) throw new AppError('NOT_FOUND', 'No verdict exists for this claim.');
  const r = result.data()!;
  const d = decision.data()!;
  const canonical = JSON.stringify({
    claimId,
    topicStatement: r.topicStatement,
    verdict: d.verdict,
    verdictBasis: d.verdictBasis,
    winner: d.winner,
    reasoning: d.reasoning,
    decisiveEvidenceIds: d.decisiveEvidenceIds,
    evidence: evidence.docs
      .map((e) => e.data())
      .sort((a, b) => String(a.evidenceId).localeCompare(String(b.evidenceId), undefined, { numeric: true }))
      .map((e) => [e.evidenceId, e.sourceUrl, e.provenanceStatus, e.excerpt]),
  });
  return { hash: createHash('sha256').update(canonical).digest('hex'), verdict: d.verdict, topicStatement: r.topicStatement, jobId: r.jobId, userId: r.userId };
}

platformRouter.post(
  '/receipts',
  handler(async (req) => {
    const { claimId } = parse(z.object({ claimId: z.string().max(120) }), req.body);
    const fp = await fingerprint(claimId);
    if (fp.userId !== req.user!.uid) throw new AppError('NOT_FOUND', 'Not found.');
    const receiptId = newId();
    const doc = { receiptId, userId: req.user!.uid, claimId, jobId: fp.jobId, verdict: fp.verdict, topicStatement: fp.topicStatement, hash: fp.hash, algorithm: 'SHA-256', createdAtMs: Date.now() };
    await col(C.receipts).doc(receiptId).set(doc);
    return doc;
  }),
);

platformRouter.get(
  '/receipts',
  handler(async (req) => {
    const snap = await col(C.receipts).where('userId', '==', req.user!.uid).orderBy('createdAtMs', 'desc').limit(100).get();
    return { items: snap.docs.map((d) => d.data()) };
  }),
);

platformRouter.get(
  '/receipts/:id/verify',
  handler(async (req) => {
    const snap = await col(C.receipts).doc(req.params.id!).get();
    const r = snap.data();
    if (!r || r.userId !== req.user!.uid) throw new AppError('NOT_FOUND', 'Not found.');
    const now = await fingerprint(r.claimId).catch(() => null);
    return { intact: now?.hash === r.hash, currentHash: now?.hash ?? null, receiptHash: r.hash };
  }),
);

// ---------------------------------------------------------------------------
// Notifications (written by the pipeline when an investigation finishes)
// ---------------------------------------------------------------------------
platformRouter.get(
  '/notifications',
  handler(async (req) => {
    const snap = await col(C.notifications).where('userId', '==', req.user!.uid).orderBy('createdAtMs', 'desc').limit(50).get();
    return { items: snap.docs.map((d) => d.data()) };
  }),
);

platformRouter.get(
  '/notifications/unread-count',
  handler(async (req) => {
    const snap = await col(C.notifications).where('userId', '==', req.user!.uid).where('read', '==', false).count().get();
    return { unread: snap.data().count };
  }),
);

platformRouter.post(
  '/notifications/:id/read',
  handler(async (req) => {
    const ref = col(C.notifications).doc(req.params.id!);
    const snap = await ref.get();
    if (!snap.exists || snap.get('userId') !== req.user!.uid) throw new AppError('NOT_FOUND', 'Not found.');
    await ref.update({ read: true });
    return { ok: true };
  }),
);

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------
const admin = Router();
admin.use(requireRole('admin'));

admin.get(
  '/users',
  handler(async (req) => {
    const { cursor } = parse(z.object({ cursor: z.string().optional() }), req.query);
    let q = col(C.users).orderBy('email').limit(50);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    const items = snap.docs.map((d) => {
      const u = d.data();
      return { uid: u.uid, email: u.email, displayName: u.displayName ?? null, role: u.role, accountStatus: u.accountStatus };
    });
    return { items, nextCursor: items.length === 50 ? items.at(-1)!.email : null };
  }),
);

/** Roles are granted only here, by an administrator (users document + custom claim). */
admin.patch(
  '/users/:uid/role',
  handler(async (req) => {
    const { role } = parse(SetRoleSchema, req.body);
    if (req.params.uid === req.user!.uid && role !== 'admin') throw new AppError('CONFLICT', 'You cannot remove your own administrator role.');
    const ref = col(C.users).doc(req.params.uid!);
    if (!(await ref.get()).exists) throw new AppError('NOT_FOUND', 'Not found.');
    await ref.update({ role, updatedAt: FieldValue.serverTimestamp() });
    await adminAuth().setCustomUserClaims(req.params.uid!, { role });
    await auditLog(req.user!.uid, 'role_changed', req.params.uid!, { role });
    return { ok: true };
  }),
);

admin.patch(
  '/users/:uid/status',
  handler(async (req) => {
    const { accountStatus } = parse(SetAccountStatusSchema, req.body);
    if (req.params.uid === req.user!.uid) throw new AppError('CONFLICT', 'You cannot suspend your own account.');
    await col(C.users).doc(req.params.uid!).update({ accountStatus, updatedAt: FieldValue.serverTimestamp() });
    await auditLog(req.user!.uid, 'account_status_changed', req.params.uid!, { accountStatus });
    return { ok: true };
  }),
);

/** Real recorded stage durations and AI calls (PART 10.5 rule 7). */
admin.get(
  '/performance',
  handler(async () => {
    const snap = await db().collectionGroup('stageRuns').where('status', 'in', ['completed', 'failed']).limit(1000).get();
    const agg = new Map<string, { runs: number; failed: number; total: number; max: number; ai: number }>();
    for (const d of snap.docs) {
      const r = d.data();
      const kind = String(r.stageKey).split(':')[0] + (String(r.stageKey).startsWith('debate:') ? `:${String(r.stageKey).split(':')[2]}` : '');
      const a = agg.get(kind) ?? { runs: 0, failed: 0, total: 0, max: 0, ai: 0 };
      a.runs++;
      if (r.status === 'failed') a.failed++;
      a.total += r.durationMs ?? 0;
      a.max = Math.max(a.max, r.durationMs ?? 0);
      a.ai += r.aiCalls ?? 0;
      agg.set(kind, a);
    }
    const jobs = await col(C.jobs).where('status', 'in', ['completed', 'partially_completed']).orderBy('completedAtMs', 'desc').limit(100).get().catch(() => null);
    const durations = (jobs?.docs ?? []).map((d) => (d.get('completedAtMs') as number) - (d.get('startedAtMs') as number)).filter((n) => n > 0);
    return {
      stages: [...agg.entries()].map(([stage, a]) => ({ stage, runs: a.runs, failed: a.failed, avgMs: Math.round(a.total / a.runs), maxMs: a.max, aiCalls: a.ai })).sort((x, y) => x.stage.localeCompare(y.stage)),
      jobs: { count: durations.length, avgMs: durations.length ? Math.round(durations.reduce((s, n) => s + n, 0) / durations.length) : null, maxMs: durations.length ? Math.max(...durations) : null },
    };
  }),
);

admin.get(
  '/activity',
  handler(async () => {
    const snap = await col(C.auditLogs).orderBy('timestamp', 'desc').limit(100).get();
    return { items: snap.docs.map((d) => ({ id: d.id, ...d.data(), timestamp: d.get('timestamp')?.toMillis?.() ?? null })) };
  }),
);

/** Platform settings are configured through server environment variables; shown read-only (no secrets). */
admin.get(
  '/settings',
  handler(async () => ({
    models: MODELS,
    limits: USAGE_LIMITS,
    budgets: RESEARCH_BUDGETS,
    pipeline: PIPELINE,
    research: { maxEvidencePerDomain: RESEARCH.maxEvidencePerDomain, fetchTimeoutMs: RESEARCH.fetchTimeoutMs },
    cacheTtlMs: CACHE_TTL_MS,
    audit: AUDIT,
  })),
);

platformRouter.use('/admin', admin);
