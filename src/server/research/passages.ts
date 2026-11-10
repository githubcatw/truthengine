// Deterministic preselection of candidate passages from fetched content. This
// only narrows what is sent to the model; it never decides claim support.
import { RESEARCH } from '../config';

export interface Passage {
  id: string;
  page: number | null;
  text: string;
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
}

function splitIntoWindows(text: string, size: number): string[] {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?։:;])\s+/u);
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + ' ' + s).length > size && cur) {
      out.push(cur.trim());
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur.trim()) out.push(cur.trim());
  // Very long "sentences" (tables, lists) are cut to the window size.
  return out.flatMap((w) => (w.length <= size * 1.5 ? [w] : w.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? []));
}

function score(window: string, terms: Map<string, number>): number {
  let s = 0;
  const seen = new Set<string>();
  for (const t of tokenize(window)) {
    const w = terms.get(t);
    if (w && !seen.has(t)) {
      s += w;
      seen.add(t);
    }
  }
  return s;
}

export function buildTerms(texts: string[]): Map<string, number> {
  const terms = new Map<string, number>();
  for (const t of texts.flatMap(tokenize)) terms.set(t, /^\d+$/.test(t) ? 3 : 1);
  return terms;
}

/** Picks the most relevant passages of a source. For PDFs also limits the pages read. */
export function selectPassages(
  sourceRef: string,
  pages: Array<{ page: number | null; text: string }>,
  terms: Map<string, number>,
  maxPages: number,
  count = RESEARCH.passagesPerSource,
): { passages: Passage[]; pagesRead: number } {
  const rankedPages = pages
    .map((p) => ({ ...p, s: score(p.text, terms) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(1, maxPages));
  const windows = rankedPages.flatMap((p) =>
    splitIntoWindows(p.text, RESEARCH.passageChars).map((text) => ({ page: p.page, text, s: score(text, terms) })),
  );
  const passages = windows
    .sort((a, b) => b.s - a.s)
    .slice(0, count)
    .map((w, i) => ({ id: `${sourceRef}-P${i + 1}`, page: w.page, text: w.text }));
  return { passages, pagesRead: rankedPages.length };
}
