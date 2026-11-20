// Firestore side of the credibility database: batched lookups with a small cache, and the
// replace-by-origin write used by the import scripts. One document per (origin, host) so a
// re-import of one list never touches another.
import { z } from 'zod';
import {
  CredibilityTierSchema,
  normalizeHost,
  PolicyOriginSchema,
  SourceCategorySchema,
  SourceUseSchema,
  type PolicyOrigin,
  type SourcePolicy,
} from '../../../shared/credibility';
import { db } from '../../firebase';
import { log } from '../../logger';
import { C, col } from '../../pipeline/store';
import { candidateHosts, resolvePolicy, type StoredCredibility } from './resolve';

const StoredSchema = z.object({
  host: z.string(),
  origin: PolicyOriginSchema.exclude(['builtin']),
  name: z.string(),
  tier: CredibilityTierSchema,
  use: SourceUseSchema,
  category: SourceCategorySchema,
  attribution: z.boolean(),
  note: z.string(),
  stateOwned: z.boolean().optional(),
  sourceUrl: z.string().nullable(),
  importedAtMs: z.number(),
});

const STORED_ORIGINS = ['wikipedia_rsp', 'doaj', 'euvsdisinfo'] as const;
export const credibilityDocId = (origin: string, host: string) => `${origin}__${host}`;

const TTL_MS = 10 * 60_000;
const MAX_CACHED = 5000;
const cache = new Map<string, { at: number; policy: SourcePolicy | null }>();
export const invalidateCredibility = () => cache.clear();

/** Policy for each host (null when the site is unknown). Hosts that are not valid names map to null. */
export async function policiesFor(hosts: readonly string[]): Promise<Map<string, SourcePolicy | null>> {
  const out = new Map<string, SourcePolicy | null>();
  const now = Date.now();
  const todo: string[] = [];
  for (const raw of new Set(hosts)) {
    const host = normalizeHost(raw);
    if (!host) {
      out.set(raw, null);
      continue;
    }
    const hit = cache.get(host);
    if (hit && now - hit.at < TTL_MS) out.set(raw, hit.policy);
    else todo.push(host);
  }
  if (!todo.length) return out;

  const refs = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const host of todo) for (const h of candidateHosts(host)) for (const o of STORED_ORIGINS) refs.set(credibilityDocId(o, h), col(C.sourceCredibility).doc(credibilityDocId(o, h)));
  const stored: StoredCredibility[] = [];
  let lookupOk = true;
  try {
    const all = [...refs.values()];
    for (let i = 0; i < all.length; i += 300) {
      for (const snap of await db().getAll(...all.slice(i, i + 300))) {
        if (!snap.exists) continue;
        const parsed = StoredSchema.safeParse(snap.data());
        if (parsed.success) stored.push(parsed.data);
      }
    }
  } catch (err) {
    // Degrade to the built-in rules rather than stop the research; do not cache this answer.
    lookupOk = false;
    log.warn('credibility lookup failed; using built-in rules only', { error: (err as Error).message });
  }

  if (cache.size > MAX_CACHED) cache.clear();
  for (const host of todo) {
    const policy = resolvePolicy(host, stored);
    if (lookupOk) cache.set(host, { at: now, policy });
    for (const raw of hosts) if (normalizeHost(raw) === host) out.set(raw, policy);
  }
  return out;
}

export async function policyFor(host: string): Promise<SourcePolicy | null> {
  return (await policiesFor([host])).get(host) ?? null;
}

export interface ReplaceResult {
  written: number;
  removed: number;
}

/** Makes the stored records of one origin exactly `records`: upserts them and deletes the origin's other documents. */
export async function replaceOrigin(origin: Exclude<PolicyOrigin, 'builtin'>, records: StoredCredibility[]): Promise<ReplaceResult> {
  const keep = new Set(records.map((r) => credibilityDocId(origin, r.host)));
  const existing = await col(C.sourceCredibility).where('origin', '==', origin).select().get();
  const stale = existing.docs.filter((d) => !keep.has(d.id));

  const ops: Array<(b: FirebaseFirestore.WriteBatch) => void> = [
    ...records.map((r) => (b: FirebaseFirestore.WriteBatch) => b.set(col(C.sourceCredibility).doc(credibilityDocId(origin, r.host)), r)),
    ...stale.map((d) => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
  ];
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db().batch();
    for (const op of ops.slice(i, i + 400)) op(batch);
    await batch.commit();
  }
  invalidateCredibility();
  return { written: records.length, removed: stale.length };
}
