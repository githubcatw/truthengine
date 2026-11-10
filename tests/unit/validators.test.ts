import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvidenceRecord } from '../../src/shared/schemas';
import { sentenceCount, validateSideOutput, isSupported } from '../../src/server/pipeline/handlers/debate';
import { validateJudge } from '../../src/server/pipeline/handlers/judge';
import { independentCount, isSufficient, budgetFor } from '../../src/server/pipeline/handlers/research';
import { finalStatus } from '../../src/server/pipeline/handlers/finalize';
import { FINDING_LABELS, citationMatches } from '../../src/server/pipeline/handlers/audit';
import { fetchSource, htmlToText } from '../../src/server/research/fetcher';
import { excerptLabel } from '../../src/server/validation/contract';
import { JudgeOutputSchema } from '../../src/shared/agents';

const ev = (id: string, patch: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  evidenceId: id,
  claimId: 'c',
  jobId: 'j',
  userId: 'u',
  foundByAgent: 'researcher',
  sourceTitle: 't',
  sourceOrganization: null,
  sourceUrl: `https://${id}.example.org`,
  urlOrigin: 'fetched_page',
  domain: `${id}.example.org`,
  sourceType: 'paper',
  originalSourceId: null,
  excerpt: 'The river flows north through the valley for many kilometres.',
  snippet: null,
  excerptLocation: null,
  publicationDate: null,
  retrievalDate: '2026-01-01',
  provenanceStatus: 'quote_verified',
  failureReason: null,
  qualityAssessment: {
    credibility: { rating: 'high', rationale: 'x' },
    currency: { rating: 'high', rationale: 'x' },
    methodology: { rating: 'high', rationale: 'x' },
    independence: { rating: 'high', rationale: 'x' },
    relevance: { rating: 'high', rationale: 'x' },
  },
  provisionalRelation: 'supports',
  directness: 'direct',
  conditionsMatch: true,
  conditionsNote: null,
  countsAsIndependent: true,
  trustedSource: null,
  ...patch,
});

describe('debate validators', () => {
  it('counts sentences in Latin, Cyrillic and Armenian text', () => {
    expect(sentenceCount('One sentence. Two sentences.')).toBe(2);
    expect(sentenceCount('Первое. Второе. Третье.')).toBe(3);
    expect(sentenceCount('Առաջին նախադասություն։ Երկրորդ նախադասություն։')).toBe(2);
    expect(sentenceCount('See p. 4 for details.')).toBe(1);
  });

  const byId = new Map([['E1', ev('E1')], ['E2', ev('E2', { provenanceStatus: 'search_metadata_only', excerpt: null, snippet: 'lead text here' })]]);
  const opponentArg = { agentType: 'prosecutor', messageType: 'argument', argumentId: 'P-1' } as never;

  it('rejects unknown evidence IDs and non-verbatim quoted passages', () => {
    const out = {
      arguments: [{ text: 'Supported.', evidenceIds: ['E9'] }],
      evidenceAssessments: [{ evidenceId: 'E1', quotedPassage: 'The river flows south' }],
    };
    const err = validateSideOutput('r1_initial', 'defender', out, { byId, messages: [], challenges: [] });
    expect(err).toMatch(/E9/);
    expect(err).toMatch(/not copied verbatim/);
  });

  it('challenges must target existing opponent arguments', () => {
    const ok = validateSideOutput('r2a_challenges', 'defender', { challenges: [{ targetArgumentId: 'P-1', evidenceIds: [], text: 'Weak.' }] }, { byId, messages: [opponentArg], challenges: [] });
    expect(ok).toBeNull();
    const bad = validateSideOutput('r2a_challenges', 'defender', { challenges: [{ targetArgumentId: 'P-7', evidenceIds: [], text: 'Weak.' }] }, { byId, messages: [opponentArg], challenges: [] });
    expect(bad).toMatch(/P-7/);
  });

  it('allows zero arguments (no minimum) and flags arguments without retrieved sources', () => {
    expect(validateSideOutput('r1_initial', 'prosecutor', { arguments: [], evidenceAssessments: [] }, { byId, messages: [], challenges: [] })).toBeNull();
    expect(isSupported(['E1'], byId)).toBe(true);
    expect(isSupported(['E2'], byId)).toBe(false); // a search snippet is a lead, not retrieved content
    expect(isSupported([], byId)).toBe(false);
  });

  it('every challenge directed at an agent must be answered', () => {
    const challenges = [{ challengeId: 'CP-1', challengerAgent: 'prosecutor', challengedArgumentId: 'D-1' }] as never;
    expect(validateSideOutput('r2b_responses', 'defender', { responses: [] }, { byId, messages: [], challenges })).toMatch(/CP-1/);
  });
});

describe('Judge validator', () => {
  const evidence = [ev('E1'), ev('E2', { provenanceStatus: 'fetched', excerpt: null })];
  const base = {
    claimId: 'c',
    debateId: 'd',
    topicHash: 'a'.repeat(64),
    winner: 'DEFENDER',
    verdict: 'CORRECT',
    verdictBasis: 'established',
    reasoning: 'r',
    whatWasEstablished: [],
    whatWasNotEstablished: [],
    defender: { established: [], failedToEstablish: [] },
    prosecutor: { established: [], failedToEstablish: [] },
    decisiveEvidenceIds: ['E1'],
    decisiveEvidenceRationale: 'r',
    acceptedArgumentIds: ['D-1'],
    rejectedArguments: [],
    evidenceStrength: 'Limited',
    limitations: [],
    studentConclusion: 's',
    believability: { whyBelievable: [], whyMightBeWrong: [], canEstablish: [], cannotEstablish: [] },
  } as const;
  const args = new Set(['D-1', 'P-1']);

  it('accepts a consistent decision, including limited evidence', () => {
    expect(validateJudge(JudgeOutputSchema.parse(base), evidence, args)).toBeNull();
  });
  it('rejects winner/verdict mismatch and inconsistent basis', () => {
    expect(validateJudge({ ...base, verdict: 'WRONG', verdictBasis: 'contradicted' } as never, evidence, args)).toMatch(/requires verdict CORRECT/);
    expect(validateJudge({ ...base, verdictBasis: 'not_established' } as never, evidence, args)).toMatch(/CORRECT requires/);
    expect(validateJudge({ ...base, winner: 'PROSECUTOR', verdict: 'WRONG' } as never, evidence, args)).toMatch(/WRONG cannot/);
  });
  it('rejects decisive evidence that is not quote_verified and unknown IDs', () => {
    expect(validateJudge({ ...base, decisiveEvidenceIds: ['E2'] } as never, evidence, args)).toMatch(/quote_verified: E2/);
    expect(validateJudge({ ...base, decisiveEvidenceIds: ['E7'] } as never, evidence, args)).toMatch(/E7/);
    expect(validateJudge({ ...base, acceptedArgumentIds: ['D-9'] } as never, evidence, args)).toMatch(/D-9/);
  });
  it('the schema rejects any third verdict', () => {
    expect(JudgeOutputSchema.safeParse({ ...base, verdict: 'UNVERIFIABLE' }).success).toBe(false);
    expect(JudgeOutputSchema.safeParse({ ...base, winner: 'TIE' }).success).toBe(false);
  });
});

describe('research budgets and independence', () => {
  it('articles repeating the same original source are not independent', () => {
    const recs = [ev('E1'), ev('E2', { domain: 'E1.example.org' }), ev('E3', { originalSourceId: 'Primary report' })];
    expect(independentCount(recs)).toBe(1);
  });
  it('sufficiency needs direct, credible, independent verified evidence; targets never force invention', () => {
    expect(isSufficient([ev('E1'), ev('E2')], 2)).toBe(true);
    expect(isSufficient([ev('E1'), ev('E2', { directness: 'contextual' })], 2)).toBe(false);
    expect(isSufficient([ev('E1'), ev('E2', { provenanceStatus: 'fetched' })], 2)).toBe(false);
  });
  it('deeper investigation enlarges the budget', () => {
    const c = { complexityClass: 'basic' } as never;
    expect(budgetFor(c, true).maxSearches).toBeGreaterThan(budgetFor(c, false).maxSearches);
  });
});

describe('job outcome', () => {
  const claim = (outcome: string) => ({ status: 'confirmed', selected: true, outcome }) as never;
  it('derives status from real claim outcomes', () => {
    expect(finalStatus([claim('judged')])).toBe('completed');
    expect(finalStatus([claim('judged'), claim('research_failed')])).toBe('partially_completed');
    expect(finalStatus([claim('research_failed')])).toBe('research_failed');
    expect(finalStatus([claim('failed')])).toBe('failed');
  });
});

describe('audit wording', () => {
  it('never labels references or quotes as fake/invented, and never mentions AI authorship', () => {
    for (const label of Object.values(FINDING_LABELS)) {
      expect(label).not.toMatch(/fake|invented|fabricat|AI/i);
    }
    expect(FINDING_LABELS.reference_unverified).toBe('Reference could not be independently verified');
    expect(FINDING_LABELS.quotation_unverified).toBe('Quotation could not be verified');
  });
  it('matches citations only on most of their distinctive words', () => {
    expect(citationMatches('History of the Armenian People, Volume Two', ['History of the Armenian People volume two — publisher'])).toBe(true);
    expect(citationMatches('History of the Armenian People, Volume Two', ['Unrelated cooking blog'])).toBe(false);
  });
});

describe('fetcher (layer A)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [403, 'blocked_403'],
    [429, 'rate_limited_429'],
    [401, 'auth_required'],
    [404, 'not_found'],
  ])('records HTTP %i as %s', async (status, reason) => {
    vi.stubGlobal('fetch', async () => new Response('x', { status }));
    const r = await fetchSource('https://93.184.216.34/page');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });

  it('an HTTP 200 page is only "retrieved" — never verified or credible by itself', async () => {
    vi.stubGlobal('fetch', async () => new Response(`<html><title>T</title><body><p>${'Readable text. '.repeat(30)}</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } }));
    const r = await fetchSource('https://93.184.216.34/ok');
    expect(r.ok).toBe(true);
    expect(excerptLabel('fetched')).toBe('Retrieved source (excerpt not verified)');
  });

  it('unparseable content is a parse_error, and private addresses are refused', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const r = await fetchSource('https://93.184.216.34/empty');
    expect(!r.ok && r.reason).toBe('parse_error');
    const p = await fetchSource('http://127.0.0.1/admin');
    expect(p.ok).toBe(false);
  });

  it('extracts readable text and decodes entities, dropping scripts', () => {
    const { title, text } = htmlToText('<title>A &amp; B</title><script>evil()</script><p>Hello&nbsp;world &#1329;</p>');
    expect(title).toBe('A & B');
    expect(text).toContain('Hello world Ա');
    expect(text).not.toContain('evil');
  });
});
