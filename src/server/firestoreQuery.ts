// Ordered, paginated queries that keep working before composite indexes exist.
// Firestore rejects "filter on A, order by B" with FAILED_PRECONDITION until the
// index from firestore.indexes.json is created (the emulator never enforces this).
// In that case we run the equality-only query, sort in memory (bounded), and log
// Firestore's index-creation link once so the admin can create it in one click.
import type { DocumentData, Query } from 'firebase-admin/firestore';
import { log } from './logger';

const FALLBACK_LIMIT = 1000;
const warned = new Set<string>();

export function isMissingIndex(err: unknown): boolean {
  const e = err as { code?: number | string; message?: string };
  return e?.code === 9 || e?.code === 'failed-precondition' || /FAILED_PRECONDITION|requires an index/i.test(String(e?.message ?? ''));
}

export function warnMissingIndex(name: string, err: unknown) {
  if (warned.has(name)) return;
  warned.add(name);
  const link = String((err as Error)?.message ?? '').match(/https:\/\/console\.firebase\.google\.com\S+/)?.[0];
  log.warn('Firestore index missing; using a slower in-memory fallback. Create the index (or deploy firestore.indexes.json).', {
    query: name,
    createIndexLink: link ?? null,
  });
}

export interface OrderedQuery {
  /** A name for logs, e.g. "verificationJobs by user". */
  name: string;
  /** The query with equality filters only. */
  base: Query;
  orderBy: string;
  direction: 'asc' | 'desc';
  limit: number;
  /** Value of `orderBy` to start after (cursor pagination). */
  after?: unknown;
  /** Extra equality-free filter (e.g. seq > n) applied in the fallback too. */
  where?: { field: string; op: '>' | '<'; value: unknown };
}

export async function orderedQuery(q: OrderedQuery): Promise<DocumentData[]> {
  try {
    let query = q.base;
    if (q.where) query = query.where(q.where.field, q.where.op, q.where.value);
    query = query.orderBy(q.orderBy, q.direction);
    if (q.after !== undefined && q.after !== null) query = query.startAfter(q.after);
    const snap = await query.limit(q.limit).get();
    return snap.docs.map((d) => d.data());
  } catch (err) {
    if (!isMissingIndex(err)) throw err;
    warnMissingIndex(q.name, err);
    const snap = await q.base.limit(FALLBACK_LIMIT).get();
    const cmp = (a: unknown, b: unknown) => (a === b ? 0 : (a as number) < (b as number) ? -1 : 1);
    let rows = snap.docs.map((d) => d.data());
    if (q.where) rows = rows.filter((r) => (q.where!.op === '>' ? cmp(r[q.where!.field], q.where!.value) > 0 : cmp(r[q.where!.field], q.where!.value) < 0));
    rows.sort((a, b) => (q.direction === 'asc' ? 1 : -1) * cmp(a[q.orderBy], b[q.orderBy]));
    if (q.after !== undefined && q.after !== null) {
      rows = rows.filter((r) => (q.direction === 'asc' ? cmp(r[q.orderBy], q.after) > 0 : cmp(r[q.orderBy], q.after) < 0));
    }
    return rows.slice(0, q.limit);
  }
}
