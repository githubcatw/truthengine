// Fast research mode: reuse work from similar earlier questions.
//
//   plan cache    a claim close in meaning to an earlier one reuses that claim's planned queries
//   search cache  a query close in meaning to an earlier one reuses that query's search results
//
// Both hold public data only (queries are already sent to a web search). Embeddings capture topic
// well but are blind to small factual changes ("1920" versus "1921"), so a reuse is refused when
// the numbers in the two texts differ. Nothing here reuses a verdict or an assessment. The plan cache
// never stores claim text (it may come from a private document): only an embedding, a digits signature
// and the planned queries, which are sent to a web search anyway.
import { FieldValue } from 'firebase-admin/firestore';
import type { GeminiClient } from '../ai/gemini';
import { CACHE_TTL_MS, SEMANTIC } from '../config';
import { nearestDocs } from '../kb/store';
import { log } from '../logger';
import { C, col, hashId } from '../pipeline/store';
import type { TimeSensitivity } from '../../shared/schemas';
import type { CachedSearch } from './cache';

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const numbersOf = (s: string) => (s.match(/\d+/g) ?? []).sort().join(',');

/** Two texts may share cached work only if they mention the same numbers. */
export function sameNumbers(a: string, b: string): boolean {
  return numbersOf(a) === numbersOf(b);
}

/** Best effort: a failed embedding just means no caching for this call. */
export async function tryEmbed(gemini: GeminiClient, texts: string[]): Promise<number[][] | null> {
  if (!texts.length) return [];
  try {
    return await gemini.embed({ texts, task: 'similarity' });
  } catch (err) {
    log.warn('semantic_cache.embed_failed', { error: (err as Error).message });
    return null;
  }
}

export interface PlanItem {
  track: 'neutral' | 'supporting' | 'contradicting';
  query: string;
  language: 'hy' | 'en' | 'ru';
}

export async function findSimilarSearch(
  vector: number[],
  query: string,
  language: string,
  sensitivity: TimeSensitivity,
  nowMs = Date.now(),
): Promise<(CachedSearch & { matchedQuery: string; similarity: number }) | null> {
  try {
    const found = await nearestDocs(col(C.searchCache).where('language', '==', language), vector, SEMANTIC.candidates);
    for (const f of found) {
      if (f.similarity < SEMANTIC.querySimilarity) break;
      const d = f.data;
      if (d.expiresAtMs <= nowMs) continue;
      // A search saved for a stable claim lives 7 days; a time-sensitive claim must not reuse it past its own limit.
      if (nowMs - d.fetchedAtMs > CACHE_TTL_MS[sensitivity]) continue;
      if (!sameNumbers(d.query, query)) continue;
      return { sources: d.sources, webSearchQueries: d.webSearchQueries, matchedQuery: d.query, similarity: f.similarity };
    }
  } catch (err) {
    log.warn('semantic_cache.search_lookup_failed', { error: (err as Error).message });
  }
  return null;
}

export async function findSimilarPlan(vector: number[], claimText: string, language: string, nowMs = Date.now()): Promise<{ queries: PlanItem[]; similarity: number } | null> {
  try {
    const found = await nearestDocs(col(C.planCache).where('language', '==', language), vector, SEMANTIC.candidates);
    for (const f of found) {
      if (f.similarity < SEMANTIC.planSimilarity) break;
      const d = f.data;
      if (nowMs - d.createdAtMs > SEMANTIC.planMaxAgeMs) continue;
      if (d.numbers !== numbersOf(claimText)) continue;
      return { queries: d.queries as PlanItem[], similarity: f.similarity };
    }
  } catch (err) {
    log.warn('semantic_cache.plan_lookup_failed', { error: (err as Error).message });
  }
  return null;
}

export async function putPlan(claimText: string, language: string, queries: PlanItem[], vector: number[]) {
  try {
    await col(C.planCache).doc(hashId('plan', norm(claimText), language)).set({ numbers: numbersOf(claimText), language, queries, createdAtMs: Date.now(), embedding: FieldValue.vector(vector) });
  } catch (err) {
    log.warn('semantic_cache.plan_store_failed', { error: (err as Error).message });
  }
}
