import { describe, expect, it } from 'vitest';
import { normalize } from '../../src/server/ai/gemini';
import { chunkPages } from '../../src/server/kb/chunk';
import { independenceDomain, kbLooksStrong, type KbSource } from '../../src/server/kb/retrieve';
import { cosine } from '../../src/server/kb/store';
import { fakeEmbedding } from '../helpers/fakeGemini';

const src = (domain: string, best: number): KbSource => ({
  sourceId: domain,
  scope: 'public',
  url: `https://${domain}/x`,
  title: null,
  kind: 'web',
  fetchedAtMs: 0,
  domain,
  host: domain,
  best,
  passages: [],
});

describe('knowledge base helpers', () => {
  it('chunks pages in order, drops tiny fragments and respects the caps', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says something long enough to matter here.`).join(' ');
    const chunks = chunkPages([{ page: 1, text: 'Hi.' }, { page: 2, text }], { size: 300 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.text.length >= 40 && c.page === 2)).toBe(true);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    expect(chunkPages([{ page: null, text }], { size: 300, maxChunks: 2 })).toHaveLength(2);
    expect(chunkPages([{ page: null, text }], { size: 300, maxChars: 500 }).reduce((n, c) => n + c.text.length, 0)).toBeLessThanOrEqual(500);
  });

  it('normalizes embeddings to unit length so the dot product is the cosine', () => {
    const v = normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(cosine(v, v)).toBeCloseTo(1);
  });

  it('counts the three Wikipedia editions as one independent source', () => {
    expect(independenceDomain('hy.wikipedia.org')).toBe('wikipedia.org');
    expect(independenceDomain('en.wikipedia.org')).toBe('wikipedia.org');
    expect(independenceDomain('armstat.am')).toBe('armstat.am');
    // Three Wikipedia hits are not "enough independent sources" for a target of two.
    expect(kbLooksStrong(['hy', 'ru', 'en'].map((l) => src(independenceDomain(`${l}.wikipedia.org`), 0.9)), 2)).toBe(false);
    expect(kbLooksStrong([src('wikipedia.org', 0.9), src('armstat.am', 0.8)], 2)).toBe(true);
  });

  it('only counts strong matches towards skipping the web search', () => {
    expect(kbLooksStrong([src('a.org', 0.9), src('b.org', 0.65)], 2)).toBe(false);
    expect(kbLooksStrong([], 2)).toBe(false);
  });

  it('the test embedding ranks word overlap above unrelated text', () => {
    const q = fakeEmbedding('apricot orchard behind the school');
    expect(cosine(q, fakeEmbedding('The orchard behind the school has apricot trees'))).toBeGreaterThan(cosine(q, fakeEmbedding('Tax rates changed in the parliament')));
  });
});

import { sameNumbers } from '../../src/server/research/semanticCache';

describe('semantic cache guard', () => {
  it('refuses to share cached work between texts that mention different numbers', () => {
    expect(sameNumbers('The bridge was rebuilt in 1920', 'The bridge was rebuilt in 1921')).toBe(false);
    expect(sameNumbers('rebuilt in 1920 by 12 masons', '12 masons rebuilt it in 1920')).toBe(true);
    expect(sameNumbers('no numbers here', 'none here either')).toBe(true);
    expect(sameNumbers('rebuilt in 1920', 'rebuilt')).toBe(false);
  });
});
