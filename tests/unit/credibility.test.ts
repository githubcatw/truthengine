import { describe, expect, it } from 'vitest';
import { effectiveTier, isEvidenceGrade, normalizeHost, type SourcePolicy } from '../../src/shared/credibility';
import { candidateHosts, resolvePolicy, type StoredCredibility } from '../../src/server/research/credibility/resolve';
import { matchesPattern, specificity } from '../../src/server/research/credibility/rules';
import { independentCount, isSufficient, leadRank } from '../../src/server/pipeline/handlers/research';
import { isSupported, formatEvidence, positionResearchResult } from '../../src/server/pipeline/handlers/debate';
import { validateJudge } from '../../src/server/pipeline/handlers/judge';
import { JudgeOutputSchema } from '../../src/shared/agents';
import type { EvidenceRecord } from '../../src/shared/schemas';

const stored = (host: string, patch: Partial<StoredCredibility> = {}): StoredCredibility => ({
  host,
  origin: 'wikipedia_rsp',
  name: host,
  tier: 'medium',
  use: 'evidence',
  category: 'other',
  attribution: false,
  note: 'n',
  sourceUrl: null,
  importedAtMs: 0,
  ...patch,
});

describe('built-in credibility rules', () => {
  const cases: Array<[string, SourcePolicy['tier'], SourcePolicy['use'], SourcePolicy['category']]> = [
    // social networks, blogs, file sharing: low and context only
    ['facebook.com', 'low', 'context_only', 'social_media'],
    ['m.facebook.com', 'low', 'context_only', 'social_media'],
    ['x.com', 'low', 'context_only', 'social_media'],
    ['t.me', 'low', 'context_only', 'social_media'],
    ['someone.wordpress.com', 'low', 'context_only', 'blog_platform'],
    ['someone.blogspot.com', 'low', 'context_only', 'blog_platform'],
    ['scribd.com', 'low', 'context_only', 'file_sharing'],
    ['www.studocu.com', 'low', 'context_only', 'file_sharing'],
    // Wikipedia: medium and context only
    ['en.wikipedia.org', 'medium', 'context_only', 'encyclopedia'],
    ['hy.wikipedia.org', 'medium', 'context_only', 'encyclopedia'],
    // government: high
    ['usa.gov', 'high', 'evidence', 'government'],
    ['www.cdc.gov', 'high', 'evidence', 'government'],
    ['gov.am', 'high', 'evidence', 'government'],
    ['mess.gov.am', 'high', 'evidence', 'government'],
    ['escs.am', 'high', 'evidence', 'government'],
    ['www.escs.am', 'high', 'evidence', 'government'],
    // education: high
    ['mit.edu', 'high', 'evidence', 'education'],
    ['ox.ac.uk', 'high', 'evidence', 'education'],
    ['cs.tau.ac.il', 'high', 'evidence', 'education'],
    ['lib.armedu.am', 'high', 'evidence', 'education'],
    ['sci.am', 'high', 'evidence', 'education'],
    ['physics.sci.am', 'high', 'evidence', 'education'],
    // journals: high, more specific than *.sci.am
    ['journal.anau.am', 'high', 'evidence', 'journal'],
    ['mpcs.sci.am', 'high', 'evidence', 'journal'],
  ];
  it.each(cases)('%s is %s credibility, %s (%s)', (host, tier, use, category) => {
    const p = resolvePolicy(host, []);
    expect(p).toMatchObject({ tier, use, category, origin: 'builtin' });
  });

  it('does not match look-alike hosts', () => {
    for (const host of ['notfacebook.com', 'facebook.com.evil.example', 'gov.am.evil.example', 'fake-escs.am', 'anau.am', 'ysu.am', 'example.com', 'academic.org']) {
      expect(resolvePolicy(host, []), host).toBeNull();
    }
  });

  it('the who-said-what exception belongs to sources that speak for their owner', () => {
    expect(resolvePolicy('facebook.com', [])!.attribution).toBe(true);
    expect(resolvePolicy('someone.wordpress.com', [])!.attribution).toBe(true);
    // Anyone can upload a file under any name, and Wikipedia is not a speaker.
    expect(resolvePolicy('scribd.com', [])!.attribution).toBe(false);
    expect(resolvePolicy('en.wikipedia.org', [])!.attribution).toBe(false);
  });

  it('pattern matching and specificity', () => {
    expect(matchesPattern('a.b.gov.am', '*.gov.am')).toBe(true);
    expect(matchesPattern('gov.am', '*.gov.am')).toBe(true);
    expect(matchesPattern('xgov.am', '*.gov.am')).toBe(false);
    expect(matchesPattern('ox.ac.uk', '.ac.*')).toBe(true);
    expect(matchesPattern('ac.uk', '.ac.*')).toBe(true);
    expect(matchesPattern('zac.uk', '.ac.*')).toBe(false);
    expect(matchesPattern('ox.ac.com', '.ac.*')).toBe(false); // the last label must be a two-letter country code
    expect(specificity('mpcs.sci.am')).toBeGreaterThan(specificity('*.sci.am'));
  });
});

describe('precedence between rules and imported lists', () => {
  it('an explicit rule beats an imported record: Wikipedia stays medium although the perennial list calls it unreliable', () => {
    const p = resolvePolicy('en.wikipedia.org', [stored('wikipedia.org', { tier: 'low', use: 'context_only' })]);
    expect(p).toMatchObject({ tier: 'medium', origin: 'builtin', rule: 'wikipedia' });
  });

  it('platform rules cannot be raised by an import', () => {
    expect(resolvePolicy('x.wordpress.com', [stored('x.wordpress.com', { tier: 'high', origin: 'doaj', category: 'journal' })])).toMatchObject({ tier: 'low', use: 'context_only' });
  });

  it('a suffix class is only a guess: a more specific import beats .edu', () => {
    const academia = stored('academia.edu', { tier: 'low', use: 'context_only', category: 'unreliable' });
    expect(resolvePolicy('mit.edu', [academia])).toMatchObject({ tier: 'high', rule: 'education_suffix' });
    expect(resolvePolicy('www.academia.edu', [academia])).toMatchObject({ tier: 'low', use: 'context_only', origin: 'wikipedia_rsp' });
  });

  it('a disinformation record beats the .gov guess', () => {
    const p = resolvePolicy('mouthpiece.gov', [stored('mouthpiece.gov', { origin: 'euvsdisinfo', tier: 'low', use: 'context_only', category: 'disinformation' })]);
    expect(p).toMatchObject({ category: 'disinformation', use: 'context_only' });
  });

  it('DOAJ replaces the built-in journal opinion for the same host; other lists do not', () => {
    const doaj = stored('journal.anau.am', { origin: 'doaj', tier: 'medium', category: 'journal' });
    expect(resolvePolicy('journal.anau.am', [doaj])).toMatchObject({ origin: 'doaj', tier: 'medium' });
    expect(resolvePolicy('journal.anau.am', [stored('journal.anau.am', { tier: 'low' })])).toMatchObject({ origin: 'builtin', tier: 'high' });
    expect(resolvePolicy('mpcs.sci.am', [stored('sci.am', { origin: 'doaj' })])).toMatchObject({ origin: 'builtin' }); // a broader DOAJ host does not override
  });

  it('the most specific stored host wins; on a tie the most cautious record wins', () => {
    const broad = stored('example.org', { tier: 'high' });
    const narrow = stored('news.example.org', { tier: 'low', use: 'context_only' });
    expect(resolvePolicy('a.news.example.org', [broad, narrow])).toMatchObject({ tier: 'low' });
    expect(resolvePolicy('other.example.org', [broad, narrow])).toMatchObject({ tier: 'high' });
    const high = stored('both.org', { origin: 'doaj', tier: 'high' });
    const mid = stored('both.org', { origin: 'wikipedia_rsp', tier: 'medium' });
    expect(resolvePolicy('both.org', [high, mid])).toMatchObject({ tier: 'medium', origin: 'wikipedia_rsp' });
    const evidence = stored('same.org', { origin: 'doaj', tier: 'medium' });
    const context = stored('same.org', { origin: 'euvsdisinfo', tier: 'medium', use: 'context_only' });
    expect(resolvePolicy('same.org', [evidence, context])!.use).toBe('context_only');
  });

  it('lists the hosts whose records can apply', () => {
    expect(candidateHosts('a.b.example.org')).toEqual(['a.b.example.org', 'b.example.org', 'example.org']);
    expect(candidateHosts('lib.armedu.am')).toEqual(['lib.armedu.am', 'armedu.am']);
  });

  it('normalises hosts and rejects non-hosts', () => {
    expect(normalizeHost('https://WWW.Example.org:8080/a?b')).toBe('example.org');
    expect(normalizeHost('example.org.')).toBe('example.org');
    for (const bad of ['', 'localhost', '10.0.0.1', 'not a host', 'a/b']) expect(normalizeHost(bad), bad).toBeNull();
  });
});

describe('credibility decisions', () => {
  const low = resolvePolicy('facebook.com', [])!;
  const gov = resolvePolicy('mess.gov.am', [])!;
  const wiki = resolvePolicy('en.wikipedia.org', [])!;
  const file = resolvePolicy('scribd.com', [])!;

  it('the model can only lower the code-set tier', () => {
    expect(effectiveTier(gov, 'high')).toBe('high');
    expect(effectiveTier(gov, 'medium')).toBe('medium');
    expect(effectiveTier(gov, 'low')).toBe('low');
    expect(effectiveTier(low, 'high')).toBe('low');
    expect(effectiveTier(wiki, 'high')).toBe('medium');
  });
  it('an unlisted site is capped at medium whatever the model says', () => {
    expect(effectiveTier(null, 'high')).toBe('medium');
    expect(effectiveTier(undefined, 'low')).toBe('low');
    expect(effectiveTier(null, null)).toBe('medium');
  });
  it('for a claim about who said what, an owner account is medium, not low; a file upload stays low', () => {
    expect(effectiveTier(low, 'high', true)).toBe('medium');
    expect(effectiveTier(low, 'low', true)).toBe('low');
    expect(effectiveTier(file, 'high', true)).toBe('low');
  });
  it('context-only sources are evidence only for a claim about who said what, and only if they speak for their owner', () => {
    expect(isEvidenceGrade(low, false)).toBe(false);
    expect(isEvidenceGrade(low, true)).toBe(true);
    expect(isEvidenceGrade(file, true)).toBe(false);
    expect(isEvidenceGrade(wiki, true)).toBe(false);
    expect(isEvidenceGrade(gov, false)).toBe(true);
    expect(isEvidenceGrade(null, false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Effects in the pipeline
// ---------------------------------------------------------------------------
const rating = (r: 'high' | 'medium' | 'low') => ({ rating: r, rationale: 'x' });
const ev = (id: string, host: string, patch: Partial<EvidenceRecord> = {}, policy: SourcePolicy | null = resolvePolicy(host, [])): EvidenceRecord =>
  ({
    evidenceId: id,
    claimId: 'c1',
    jobId: 'j1',
    userId: 'u1',
    foundByAgent: 'researcher',
    sourceTitle: id,
    sourceOrganization: null,
    sourceUrl: `https://${host}/p`,
    urlOrigin: 'fetched_page',
    domain: host,
    sourceType: 'other',
    originalSourceId: null,
    excerpt: 'The river flows north through the valley for many kilometres.',
    snippet: null,
    excerptLocation: null,
    publicationDate: null,
    retrievalDate: '2026-01-01',
    provenanceStatus: 'quote_verified',
    failureReason: null,
    qualityAssessment: { credibility: rating('high'), currency: rating('high'), methodology: rating('high'), independence: rating('high'), relevance: rating('high') },
    provisionalRelation: 'supports',
    directness: 'direct',
    conditionsMatch: true,
    conditionsNote: null,
    countsAsIndependent: true,
    trustedSource: null,
    sourcePolicy: policy,
    ...patch,
  }) as EvidenceRecord;

describe('context-only sources in the research stage', () => {
  it('do not count as independent sources', () => {
    const recs = [ev('E1', 'mess.gov.am'), ev('E2', 'facebook.com'), ev('E3', 'en.wikipedia.org'), ev('E4', 'someone.wordpress.com')];
    expect(independentCount(recs)).toBe(1);
  });
  it('do not make the evidence sufficient, however they were rated', () => {
    const recs = [ev('E1', 'mess.gov.am'), ev('E2', 'facebook.com'), ev('E3', 'en.wikipedia.org')];
    expect(isSufficient(recs, 2)).toBe(false);
    expect(isSufficient([...recs, ev('E4', 'lib.armedu.am')], 2)).toBe(true);
  });
  it('a source rated low by the model, or an unlisted site, still follows the rules', () => {
    const lowRated = ev('E2', 'lib.armedu.am', { qualityAssessment: { credibility: rating('low'), currency: rating('high'), methodology: rating('high'), independence: rating('high'), relevance: rating('high') } });
    expect(isSufficient([ev('E1', 'mess.gov.am'), lowRated], 2)).toBe(false);
    expect(isSufficient([ev('E1', 'mess.gov.am'), ev('E2', 'unlisted.example.org')], 2)).toBe(true); // medium is credible enough
  });
  it('an official account counts for a claim about who said what', () => {
    const recs = [ev('E1', 'facebook.com'), ev('E2', 'someone.wordpress.com')];
    expect(independentCount(recs, true)).toBe(2);
    expect(isSufficient(recs, 2, true)).toBe(true);
    expect(independentCount([ev('E3', 'scribd.com'), ev('E4', 'en.wikipedia.org')], true)).toBe(0);
  });
  it('are read after the sources that can be evidence', () => {
    expect(leadRank(resolvePolicy('mess.gov.am', []), false)).toBe(0);
    expect(leadRank(null, false)).toBe(1);
    expect(leadRank(resolvePolicy('facebook.com', []), false)).toBe(2);
    expect(leadRank(resolvePolicy('facebook.com', []), true)).toBe(1);
  });
});

describe('context-only sources in the debate and the verdict', () => {
  const byId = new Map([ev('E1', 'mess.gov.am'), ev('E2', 'facebook.com'), ev('E3', 'en.wikipedia.org')].map((e) => [e.evidenceId, e] as const));
  it('an argument resting only on context-only sources is unsupported', () => {
    expect(isSupported(['E1'], byId)).toBe(true);
    expect(isSupported(['E2'], byId)).toBe(false);
    expect(isSupported(['E2', 'E3'], byId)).toBe(false);
    expect(isSupported(['E2', 'E1'], byId)).toBe(true);
  });
  it('an owner account supports an argument about who said what', () => {
    expect(isSupported(['E2'], byId, true)).toBe(true);
    expect(isSupported(['E3'], byId, true)).toBe(false);
  });
  it('a side whose only support is context-only has found nothing, unless the claim is about who said what', () => {
    const recs = [ev('E1', 'facebook.com', { foundByAgent: 'defender' })];
    expect(positionResearchResult('defender', recs)).toBe('nothing_found');
    expect(positionResearchResult('defender', recs, true)).toBe('found');
    expect(positionResearchResult('defender', [ev('E2', 'mess.gov.am', { foundByAgent: 'defender' })])).toBe('found');
  });
  it('the agents are told which records are context only', () => {
    expect(formatEvidence([byId.get('E2')!])).toMatch(/CONTEXT ONLY: background, not evidence that the claim is true/);
    expect(formatEvidence([byId.get('E3')!])).toMatch(/CONTEXT ONLY/);
    expect(formatEvidence([byId.get('E1')!])).toMatch(/credibility set by the system \(government\): high; effective high/);
    expect(formatEvidence([byId.get('E1')!])).not.toMatch(/CONTEXT ONLY/);
    expect(formatEvidence([byId.get('E2')!], true)).toMatch(/speaks for its owner/);
    expect(formatEvidence([ev('E9', 'unlisted.example.org')])).toMatch(/unlisted site, capped at medium/);
  });

  const base = {
    claimId: 'c',
    debateId: 'd',
    topicHash: 'a'.repeat(64),
    winner: 'DEFENDER', verdict: 'CORRECT', verdictBasis: 'established', reasoning: 'r', whatWasEstablished: [], whatWasNotEstablished: [],
    defender: { established: [], failedToEstablish: [] }, prosecutor: { established: [], failedToEstablish: [] },
    decisiveEvidenceIds: ['E2'], decisiveEvidenceRationale: 'r', acceptedArgumentIds: ['D-1'], rejectedArguments: [], evidenceStrength: 'Limited', limitations: [],
    studentConclusion: 's', believability: { whyBelievable: [], whyMightBeWrong: [], canEstablish: [], cannotEstablish: [] },
  } as const;
  it('the Judge cannot rest the verdict on a context-only source', () => {
    const records = [...byId.values()];
    const args = new Set(['D-1']);
    expect(validateJudge(JudgeOutputSchema.parse(base), records, args)).toMatch(/context-only sources: E2/);
    expect(validateJudge(JudgeOutputSchema.parse({ ...base, decisiveEvidenceIds: ['E3'] }), records, args)).toMatch(/context-only sources: E3/);
    expect(validateJudge(JudgeOutputSchema.parse({ ...base, decisiveEvidenceIds: ['E1'] }), records, args)).toBeNull();
  });
  it('but may for a claim about who said what, when the source speaks for its owner', () => {
    const records = [...byId.values()];
    const args = new Set(['D-1']);
    expect(validateJudge(JudgeOutputSchema.parse(base), records, args, true)).toBeNull();
    expect(validateJudge(JudgeOutputSchema.parse({ ...base, decisiveEvidenceIds: ['E3'] }), records, args, true)).toMatch(/context-only sources: E3/);
  });
});
