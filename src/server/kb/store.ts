// Knowledge base: embedded passages in Firestore with vector search.
//
// Two scopes, kept in two collections on purpose:
//   kbPublic     public web pages and encyclopedia articles. Any investigation may read it.
//   kbClassroom  teacher materials. Every query MUST carry a classroomId taken from the
//                server-side job record, and results are checked again after the query.
// Private student uploads and submissions are never indexed.
import { FieldValue, type Query } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import type { GeminiClient } from '../ai/gemini';
import { KB } from '../config';
import { db } from '../firebase';
import { log as logger } from '../logger';
import { C, col, hashId } from '../pipeline/store';
import { chunkPages, type Chunk } from './chunk';

export type KbScope = { kind: 'public' } | { kind: 'classroom'; classroomId: string };
export type PublicKind = 'web' | 'wikipedia';

export interface KbHit {
  chunkId: string;
  sourceId: string;
  scope: 'public' | 'classroom';
  /** Real URL for public sources; `material://<materialId>` for teacher materials. */
  url: string;
  title: string | null;
  kind: PublicKind | 'material';
  page: number | null;
  text: string;
  /** Cosine similarity, 0..1 for normal text. */
  similarity: number;
  /** When the text was fetched or uploaded. */
  fetchedAtMs: number;
  materialId?: string;
  fileName?: string;
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};
/** Both vectors are unit length (normalized on embedding), so the dot product is the cosine. */
export const cosine = dot;

/** The Firestore emulator has no vector search; tests rank in process using the same filters. */
function bruteForce(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST) || process.env.KB_BRUTE_FORCE === '1';
}

export const sourceIdFor = (url: string) => hashId('kb', url);
const hashText = (parts: Array<{ text: string }>) => createHash('sha256').update(parts.map((p) => p.text).join('\n')).digest('hex').slice(0, 32);

async function writeChunks(collection: string, docs: Array<{ id: string; data: Record<string, unknown>; vector: number[] }>) {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db().batch();
    for (const d of docs.slice(i, i + 400)) batch.set(col(collection).doc(d.id), { ...d.data, embedding: FieldValue.vector(d.vector) });
    await batch.commit();
  }
}

async function deleteWhere(collection: string, field: string, value: string) {
  for (;;) {
    const snap = await col(collection).where(field, '==', value).limit(400).get();
    if (snap.empty) return;
    const batch = db().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

async function embedAll(gemini: GeminiClient, chunks: Chunk[]): Promise<number[][]> {
  const vectors = await gemini.embed({ texts: chunks.map((c) => c.text), task: 'document' });
  if (vectors.length !== chunks.length || vectors.some((v) => v.length !== KB.dimensions)) throw new Error('Embedding result does not match the chunks.');
  return vectors;
}

// ---------------------------------------------------------------------------
// Public sources
// ---------------------------------------------------------------------------
export interface PublicSourceInput {
  url: string;
  title: string | null;
  kind: PublicKind;
  pages: Array<{ page: number | null; text: string }>;
  fetchedAtMs?: number;
}

/**
 * Indexes one public page. Skips work when the same content is already stored.
 * Never throws: indexing is an optimisation and must not fail research.
 */
export async function indexPublicSource(gemini: GeminiClient, input: PublicSourceInput): Promise<{ indexed: boolean; chunks: number }> {
  try {
    const chunks = chunkPages(input.pages);
    if (!chunks.length) return { indexed: false, chunks: 0 };
    const sourceId = sourceIdFor(input.url);
    const contentHash = hashText(chunks);
    const fetchedAtMs = input.fetchedAtMs ?? Date.now();
    const srcRef = col(C.kbSources).doc(sourceId);
    const existing = await srcRef.get();
    if (existing.exists && existing.get('contentHash') === contentHash) {
      // Same text again: just refresh the date so it is treated as recently verified.
      await srcRef.update({ fetchedAtMs });
      await refreshPublicDates(sourceId, fetchedAtMs);
      return { indexed: false, chunks: chunks.length };
    }
    const vectors = await embedAll(gemini, chunks);
    if (existing.exists) await deleteWhere(C.kbPublic, 'sourceId', sourceId);
    await writeChunks(
      C.kbPublic,
      chunks.map((c, i) => ({
        id: `${sourceId}_${c.index}`,
        vector: vectors[i]!,
        data: { sourceId, url: input.url, title: input.title, kind: input.kind, chunkIndex: c.index, page: c.page, text: c.text, fetchedAtMs },
      })),
    );
    await srcRef.set({ sourceId, url: input.url, title: input.title, kind: input.kind, contentHash, chunkCount: chunks.length, fetchedAtMs });
    return { indexed: true, chunks: chunks.length };
  } catch (err) {
    logger.warn('kb.index_public_failed', { url: input.url, error: (err as Error).message });
    return { indexed: false, chunks: 0 };
  }
}

async function refreshPublicDates(sourceId: string, fetchedAtMs: number) {
  const snap = await col(C.kbPublic).where('sourceId', '==', sourceId).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db().batch();
    snap.docs.slice(i, i + 400).forEach((d) => batch.update(d.ref, { fetchedAtMs }));
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// Teacher materials (classroom scope)
// ---------------------------------------------------------------------------
export interface MaterialInput {
  classroomId: string;
  materialId: string;
  teacherId: string;
  fileName: string;
  pages: Array<{ page: number | null; text: string }>;
}

/** Throws on failure: the caller reports the error to the teacher. */
export async function indexMaterial(gemini: GeminiClient, input: MaterialInput): Promise<{ chunks: number }> {
  if (!input.classroomId) throw new Error('classroomId is required.');
  const chunks = chunkPages(input.pages, { maxChunks: KB.maxChunksPerMaterial, maxChars: KB.maxChunksPerMaterial * KB.chunkChars });
  if (!chunks.length) return { chunks: 0 };
  const vectors = await embedAll(gemini, chunks);
  const now = Date.now();
  await writeChunks(
    C.kbClassroom,
    chunks.map((c, i) => ({
      id: `${input.materialId}_${c.index}`,
      vector: vectors[i]!,
      data: {
        classroomId: input.classroomId,
        materialId: input.materialId,
        teacherId: input.teacherId,
        fileName: input.fileName,
        chunkIndex: c.index,
        page: c.page,
        text: c.text,
        fetchedAtMs: now,
      },
    })),
  );
  return { chunks: chunks.length };
}

export async function deleteMaterialChunks(classroomId: string, materialId: string) {
  // Filtering on both fields means a material id from another classroom matches nothing.
  for (;;) {
    const snap = await col(C.kbClassroom).where('classroomId', '==', classroomId).where('materialId', '==', materialId).limit(400).get();
    if (snap.empty) return;
    const batch = db().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function scopedQuery(scope: KbScope): Query {
  if (scope.kind === 'public') return col(C.kbPublic);
  if (!scope.classroomId) throw new Error('A classroom search needs a classroomId.');
  return col(C.kbClassroom).where('classroomId', '==', scope.classroomId);
}

function toHit(scope: KbScope, id: string, d: FirebaseFirestore.DocumentData, similarity: number): KbHit | null {
  if (scope.kind === 'classroom') {
    // Defence in depth: the query already filters, but never trust a single check for isolation.
    if (d.classroomId !== scope.classroomId) {
      logger.error('kb.classroom_scope_violation', { chunkId: id });
      return null;
    }
    return {
      chunkId: id,
      sourceId: String(d.materialId),
      scope: 'classroom',
      url: `material://${d.materialId}`,
      title: d.fileName ?? null,
      kind: 'material',
      page: d.page ?? null,
      text: d.text,
      similarity,
      fetchedAtMs: d.fetchedAtMs,
      materialId: d.materialId,
      fileName: d.fileName,
    };
  }
  if (d.classroomId) return null; // a public hit must never carry a classroom
  return { chunkId: id, sourceId: d.sourceId, scope: 'public', url: d.url, title: d.title ?? null, kind: d.kind, page: d.page ?? null, text: d.text, similarity, fetchedAtMs: d.fetchedAtMs };
}

/** Nearest documents of a (pre-filtered) query, best first. Shared by the knowledge base and the semantic caches. */
export async function nearestDocs(base: Query, queryVector: number[], limit: number): Promise<Array<{ id: string; data: FirebaseFirestore.DocumentData; similarity: number }>> {
  if (bruteForce()) {
    const snap = await base.limit(KB.bruteForceMaxDocs).get();
    const out: Array<{ id: string; data: FirebaseFirestore.DocumentData; similarity: number }> = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      const v = (data.embedding as { toArray(): number[] } | undefined)?.toArray();
      if (!v || v.length !== queryVector.length) continue;
      out.push({ id: doc.id, data, similarity: dot(queryVector, v) });
    }
    return out.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }
  const snap = await base.findNearest({ vectorField: 'embedding', queryVector, limit, distanceMeasure: 'COSINE', distanceResultField: '_distance' }).get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data(), similarity: 1 - Number(doc.get('_distance')) }));
}

export async function searchKb(queryVector: number[], scope: KbScope, limit: number = KB.candidates): Promise<KbHit[]> {
  const found = await nearestDocs(scopedQuery(scope), queryVector, limit);
  return found.map((f) => toHit(scope, f.id, f.data, f.similarity)).filter((h): h is KbHit => h !== null);
}
