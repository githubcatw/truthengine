// Splits fetched or extracted text into passages for the knowledge base.
import { KB } from '../config';
import { splitIntoWindows } from '../research/passages';

export interface Chunk {
  index: number;
  page: number | null;
  text: string;
}

/**
 * Chunks pages in order, stopping at the character and chunk caps. Passage text is
 * stored verbatim (whitespace collapsed by the splitter) so quotations can still be
 * verified against it later.
 */
export function chunkPages(
  pages: Array<{ page: number | null; text: string }>,
  opts: { maxChars?: number; maxChunks?: number; size?: number } = {},
): Chunk[] {
  let budget = opts.maxChars ?? KB.maxIndexedCharsPerSource;
  const maxChunks = opts.maxChunks ?? Number.POSITIVE_INFINITY;
  const out: Chunk[] = [];
  for (const p of pages) {
    if (budget <= 0 || out.length >= maxChunks) break;
    const text = p.text.slice(0, budget);
    budget -= text.length;
    for (const w of splitIntoWindows(text, opts.size ?? KB.chunkChars)) {
      // Very short fragments (headings, page numbers) make poor search targets.
      if (w.length < 40) continue;
      if (out.length >= maxChunks) break;
      out.push({ index: out.length, page: p.page, text: w });
    }
  }
  return out;
}
