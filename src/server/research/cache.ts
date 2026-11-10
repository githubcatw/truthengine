// searchCache and pageCache hold public web data only (PART 10.7). Keys include
// the normalized query or URL plus language. Private documents and user results
// are never stored here.
import { CACHE_TTL_MS } from '../config';
import { C, col, hashId } from '../pipeline/store';
import type { GroundingSource } from '../ai/gemini';
import type { FetchedPage } from './fetcher';
import type { TimeSensitivity } from '../../shared/schemas';

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

export interface CachedSearch {
  sources: GroundingSource[];
  webSearchQueries: string[];
}

export async function getCachedSearch(query: string, language: string): Promise<CachedSearch | null> {
  const snap = await col(C.searchCache).doc(hashId(norm(query), language)).get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  return d.expiresAtMs > Date.now() ? { sources: d.sources, webSearchQueries: d.webSearchQueries } : null;
}

export async function putCachedSearch(query: string, language: string, sensitivity: TimeSensitivity, value: CachedSearch) {
  await col(C.searchCache)
    .doc(hashId(norm(query), language))
    .set({ query: norm(query), language, ...value, fetchedAtMs: Date.now(), expiresAtMs: Date.now() + CACHE_TTL_MS[sensitivity] });
}

export async function getCachedPage(url: string): Promise<FetchedPage | null> {
  const snap = await col(C.pageCache).doc(hashId(url)).get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  return d.expiresAtMs > Date.now() ? (d.page as FetchedPage) : null;
}

/** Stores page text, truncated to stay under Firestore's document size limit. */
export async function putCachedPage(url: string, sensitivity: TimeSensitivity, page: FetchedPage, maxChars: number) {
  let budget = maxChars;
  const pages = page.pages.map((p) => {
    const text = p.text.slice(0, Math.max(0, budget));
    budget -= text.length;
    return { page: p.page, text };
  });
  await col(C.pageCache)
    .doc(hashId(url))
    .set({ url, page: { ...page, pages }, fetchedAtMs: Date.now(), expiresAtMs: Date.now() + CACHE_TTL_MS[sensitivity] });
}
