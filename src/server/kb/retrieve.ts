// Finds stored passages for a claim before any web search is made.
//
// Scope rules (the isolation guarantee for teacher materials):
//   * classroomId comes from the server-side job record, never from model output or the request body.
//   * Without a classroomId, classroom materials are not even queried.
//   * Passages from classroom materials are never sent to web search (see research.ts).
// Freshness rules:
//   * Public pages are used only for claims classified as `stable`, and only if fetched recently.
//   * Teacher materials are used for every claim; their upload date is shown with the evidence.
import type { GeminiClient } from '../ai/gemini';
import { KB } from '../config';
import { log } from '../logger';
import type { TimeSensitivity } from '../../shared/schemas';
import { searchKb, type KbHit, type KbScope } from './store';

export interface KbPassage {
  page: number | null;
  text: string;
  similarity: number;
}

export interface KbSource {
  sourceId: string;
  scope: 'public' | 'classroom';
  url: string;
  title: string | null;
  kind: KbHit['kind'];
  fetchedAtMs: number;
  /** Key used for the independence rules. Encyclopedia language editions count as one source. */
  domain: string;
  /** Real host for registry lookups; null for teacher materials. */
  host: string | null;
  materialId?: string;
  fileName?: string;
  best: number;
  passages: KbPassage[];
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return 'unknown';
  }
};

/** hy.wikipedia.org, ru.wikipedia.org and en.wikipedia.org are one encyclopedia, not three independent sources. */
export function independenceDomain(host: string): string {
  return /(^|\.)wikipedia\.org$/.test(host) ? 'wikipedia.org' : host;
}

export const MATERIAL_DOMAIN = 'classroom-material';

function group(hits: KbHit[], maxSources: number): KbSource[] {
  const bySource = new Map<string, KbHit[]>();
  for (const h of hits) {
    const key = `${h.scope}:${h.sourceId}`;
    const list = bySource.get(key);
    if (list) list.push(h);
    else bySource.set(key, [h]);
  }
  const sources: KbSource[] = [];
  for (const list of bySource.values()) {
    list.sort((a, b) => b.similarity - a.similarity);
    const first = list[0]!;
    const host = first.scope === 'public' ? hostOf(first.url) : null;
    sources.push({
      sourceId: first.sourceId,
      scope: first.scope,
      url: first.url,
      title: first.title,
      kind: first.kind,
      fetchedAtMs: first.fetchedAtMs,
      domain: host ? independenceDomain(host) : MATERIAL_DOMAIN,
      host,
      materialId: first.materialId,
      fileName: first.fileName,
      best: first.similarity,
      passages: list.slice(0, KB.passagesPerSource).map((h) => ({ page: h.page, text: h.text, similarity: h.similarity })),
    });
  }
  return sources.sort((a, b) => b.best - a.best).slice(0, maxSources);
}

export async function retrieveForClaim(
  gemini: GeminiClient,
  input: { queries: string[]; classroomId: string | null; timeSensitivity: TimeSensitivity; nowMs?: number },
): Promise<KbSource[]> {
  const now = input.nowMs ?? Date.now();
  const queries = [...new Set(input.queries.map((q) => q.trim()).filter(Boolean))].slice(0, 2);
  const scopes: KbScope[] = [];
  if (input.timeSensitivity === 'stable') scopes.push({ kind: 'public' });
  if (input.classroomId) scopes.push({ kind: 'classroom', classroomId: input.classroomId });
  if (!queries.length || !scopes.length) return [];

  try {
    const vectors = await gemini.embed({ texts: queries, task: 'query' });
    const best = new Map<string, KbHit>();
    await Promise.all(
      scopes.flatMap((scope) =>
        vectors.map(async (v) => {
          for (const h of await searchKb(v, scope)) {
            if (h.similarity < KB.minSimilarity) continue;
            if (h.scope === 'public' && now - h.fetchedAtMs > KB.publicMaxAgeMs) continue;
            const key = `${h.scope}:${h.chunkId}`;
            const prev = best.get(key);
            if (!prev || prev.similarity < h.similarity) best.set(key, h);
          }
        }),
      ),
    );
    const all = [...best.values()];
    return [
      ...group(all.filter((h) => h.scope === 'classroom'), 4),
      ...group(all.filter((h) => h.scope === 'public'), KB.maxSourcesPerTrack),
    ];
  } catch (err) {
    // The knowledge base is an optimisation: any failure falls back to web research.
    log.warn('kb.retrieve_failed', { error: (err as Error).message });
    return [];
  }
}

/** Heuristic only: enough independent, strongly matching sources that the first web round can wait. */
export function kbLooksStrong(sources: KbSource[], targetIndependentSources: number): boolean {
  return new Set(sources.filter((s) => s.best >= KB.strongSimilarity).map((s) => s.domain)).size >= targetIndependentSources;
}
