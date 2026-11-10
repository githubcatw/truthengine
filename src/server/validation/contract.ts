// Deterministic enforcement of the zero-hallucination contract (PART 0.5).
// These checks run in code, never by asking the model, and every agent stage uses them.
import { createHash } from 'node:crypto';
import type { ProvenanceStatus, TopicLock, UrlOrigin } from '../../shared/schemas';

// ---- Rule 1: no evidence, no argument ----

/** Returns the cited IDs that do not exist for this claim. Any result means the output is rejected. */
export function findUnknownEvidenceIds(cited: readonly string[], known: ReadonlySet<string>): string[] {
  return [...new Set(cited)].filter((id) => !known.has(id));
}

export function evidenceIdError(cited: readonly string[], known: ReadonlySet<string>): string | null {
  const unknown = findUnknownEvidenceIds(cited, known);
  return unknown.length ? `Unknown evidence IDs cited: ${unknown.join(', ')}. Cite only IDs from the supplied evidence.` : null;
}

// ---- Rule 2: URLs are never written by the model ----

export interface UrlProvenanceIndex {
  grounding: ReadonlySet<string>;
  fetched: ReadonlySet<string>;
  registry: ReadonlySet<string>;
}

export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

/** Resolves where a URL came from, or null if it has no accepted origin (i.e. the model wrote it). */
export function resolveUrlOrigin(url: string, index: UrlProvenanceIndex): UrlOrigin | null {
  const n = normalizeUrl(url);
  if (!n) return null;
  const has = (set: ReadonlySet<string>) => [...set].some((s) => normalizeUrl(s) === n);
  if (has(index.fetched)) return 'fetched_page';
  if (has(index.grounding)) return 'grounding_metadata';
  if (has(index.registry)) return 'trusted_registry';
  return null;
}

// ---- Rule 3: only text found in fetched content may be a verbatim excerpt ----

export function normalizeWhitespace(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[  -​  　]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ExcerptCheck {
  verified: boolean;
  /** Character offset of the excerpt in the whitespace-normalized fetched text. */
  offset: number | null;
}

/** Verbatim (whitespace-normalized) match. No fuzzy matching: a near-miss is NOT verified. */
export function verifyExcerpt(excerpt: string, fetchedText: string, minLength = 20): ExcerptCheck {
  const e = normalizeWhitespace(excerpt);
  if (e.length < minLength) return { verified: false, offset: null };
  const idx = normalizeWhitespace(fetchedText).indexOf(e);
  return idx >= 0 ? { verified: true, offset: idx } : { verified: false, offset: null };
}

/** UI label for an excerpt, driven only by the stored provenance status. */
export function excerptLabel(status: ProvenanceStatus): string {
  switch (status) {
    case 'quote_verified':
      return 'Verified excerpt (found in retrieved content)';
    case 'fetched':
      return 'Retrieved source (excerpt not verified)';
    case 'search_metadata_only':
      return 'Search snippet (not a verified quotation)';
    case 'retrieval_failed':
      return 'Retrieval failed (not verified)';
  }
}

// ---- Rule 4: model memory is not research ----

export interface Statement {
  text: string;
  evidenceIds: readonly string[];
}

export type FlaggedStatement<S extends Statement> = S & { unsupported_assertion: boolean };

/** A statement with no existing evidence behind it is an unsupported_assertion the Judge ignores. */
export function flagUnsupported<S extends Statement>(statements: readonly S[], known: ReadonlySet<string>): FlaggedStatement<S>[] {
  return statements.map((s) => ({
    ...s,
    unsupported_assertion: s.evidenceIds.filter((id) => known.has(id)).length === 0,
  }));
}

// ---- Rule 5: fail closed ----

export function hasUsableEvidence(evidence: readonly { provenanceStatus: ProvenanceStatus }[]): boolean {
  return evidence.some((e) => e.provenanceStatus === 'quote_verified');
}

// ---- Rule 7: topic lock (identifiers first, deterministically) ----

export function computeTopicHash(input: { claimId: string; debateId: string; topicStatement: string }): string {
  return createHash('sha256')
    .update(`${input.claimId}\n${input.debateId}\n${normalizeWhitespace(input.topicStatement)}`)
    .digest('hex');
}

export function topicLockError(output: Partial<TopicLock>, expected: TopicLock): string | null {
  const wrong = (['claimId', 'debateId', 'topicHash'] as const).filter((k) => output[k] !== expected[k]);
  return wrong.length
    ? `Topic lock mismatch on ${wrong.join(', ')}. Copy claimId, debateId and topicHash exactly from the TOPIC block.`
    : null;
}
