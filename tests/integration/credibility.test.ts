import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { C, col } from '../../src/server/pipeline/store';
import { invalidateCredibility, policiesFor, replaceOrigin } from '../../src/server/research/credibility/store';
import type { StoredCredibility } from '../../src/server/research/credibility/resolve';
import { apiClient, clearEmulators, createUser, drive, fakeFetch, startServer, useGemini, type Api } from '../helpers/harness';
import { fakeGemini } from '../helpers/fakeGemini';

const fetchMock = vi.hoisted(() => ({ impl: null as null | ((u: string) => Promise<unknown>) }));
vi.mock('../../src/server/research/fetcher', async (orig) => {
  const real = await orig<typeof import('../../src/server/research/fetcher')>();
  return { ...real, fetchSource: (u: string) => fetchMock.impl!(u) };
});

const TEXT = 'The treaty was signed in the capital in the spring of that year.';
const rec = (host: string, patch: Partial<StoredCredibility> = {}): StoredCredibility => ({
  host,
  origin: 'wikipedia_rsp',
  name: host,
  tier: 'medium',
  use: 'evidence',
  category: 'other',
  attribution: false,
  note: 'test record',
  sourceUrl: null,
  importedAtMs: 1,
  ...patch,
});

let server: Server;
let base: string;

beforeAll(async () => {
  ({ server, url: base } = await startServer());
});
afterAll(() => server.close());
beforeEach(async () => {
  await clearEmulators();
  invalidateCredibility();
  fetchMock.impl = fakeFetch() as never;
});

describe('credibility database in Firestore', () => {
  it('resolves the built-in rules with nothing stored', async () => {
    const p = await policiesFor(['https://www.facebook.com/x', 'mess.gov.am', 'unlisted.example.org', 'not a host']);
    expect(p.get('https://www.facebook.com/x')).toMatchObject({ tier: 'low', use: 'context_only', origin: 'builtin' });
    expect(p.get('mess.gov.am')).toMatchObject({ tier: 'high', use: 'evidence' });
    expect(p.get('unlisted.example.org')).toBeNull();
    expect(p.get('not a host')).toBeNull();
  });

  it('applies stored records to subdomains and replaces one list at a time', async () => {
    await replaceOrigin('wikipedia_rsp', [rec('salon.example.com'), rec('badnews.example.net', { tier: 'low', use: 'context_only', category: 'unreliable' })]);
    await replaceOrigin('doaj', [rec('journal.example.org', { origin: 'doaj', tier: 'high', category: 'journal' })]);

    let p = await policiesFor(['www.salon.example.com', 'a.b.badnews.example.net', 'journal.example.org']);
    expect(p.get('www.salon.example.com')).toMatchObject({ tier: 'medium', origin: 'wikipedia_rsp', rule: 'salon.example.com' });
    expect(p.get('a.b.badnews.example.net')).toMatchObject({ tier: 'low', use: 'context_only' });
    expect(p.get('journal.example.org')).toMatchObject({ tier: 'high', origin: 'doaj' });

    // A new Wikipedia list drops the old entries, adds the new one and leaves DOAJ alone.
    const r = await replaceOrigin('wikipedia_rsp', [rec('other.example.com')]);
    expect(r).toEqual({ written: 1, removed: 2 });
    p = await policiesFor(['salon.example.com', 'badnews.example.net', 'other.example.com', 'journal.example.org']);
    expect(p.get('salon.example.com')).toBeNull();
    expect(p.get('badnews.example.net')).toBeNull();
    expect(p.get('other.example.com')).toMatchObject({ origin: 'wikipedia_rsp' });
    expect(p.get('journal.example.org')).toMatchObject({ origin: 'doaj' });
  });

  it('DOAJ replaces the built-in opinion of a journal host; Wikipedia’s list does not', async () => {
    await replaceOrigin('wikipedia_rsp', [rec('journal.anau.am', { tier: 'low' })]);
    expect(await policiesFor(['journal.anau.am'])).toEqual(new Map([['journal.anau.am', expect.objectContaining({ origin: 'builtin', tier: 'high' })]]));
    await replaceOrigin('doaj', [rec('journal.anau.am', { origin: 'doaj', tier: 'medium', category: 'journal' })]);
    invalidateCredibility();
    expect((await policiesFor(['journal.anau.am'])).get('journal.anau.am')).toMatchObject({ origin: 'doaj', tier: 'medium' });
  });

  it('ignores a malformed stored document instead of failing', async () => {
    await col(C.sourceCredibility).doc('wikipedia_rsp__junk.example.org').set({ host: 'junk.example.org', tier: 'excellent' });
    expect((await policiesFor(['junk.example.org'])).get('junk.example.org')).toBeNull();
  });

  it('is not readable by clients: the collection is covered by the default deny rule', async () => {
    const rules = (await import('node:fs')).readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    expect(rules).not.toMatch(/sourceCredibility/);
    expect(rules).toMatch(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  });
});

describe('investigations use the credibility database', () => {
  let api: Api;
  beforeEach(async () => {
    const u = await createUser(`student${Date.now()}@example.com`);
    api = apiClient(base, u.token);
  });

  async function run(scenario: Parameters<typeof fakeGemini>[0], text = TEXT) {
    const gemini = fakeGemini(scenario);
    useGemini(gemini);
    const created = await api('POST', '/verifications', { text, idempotencyKey: `key-${Math.random()}` });
    const jobId = created.body.jobId as string;
    const awaiting = await drive(api, jobId);
    const claims = awaiting.claims as Array<{ claimId: string; status: string }>;
    await api('POST', `/verifications/${jobId}/confirm`, { claims: claims.map((c) => ({ claimId: c.claimId, selected: c.status !== 'not_verifiable' })) });
    const done = await drive(api, jobId);
    const claimId = done.claims.find((c: any) => c.selected).claimId as string;
    const report = (await api('GET', `/claims/${claimId}`)).body;
    return { gemini, done, claimId, report };
  }

  it('only context-only sources (social network, Wikipedia, file sharing): research fails and no verdict is produced', async () => {
    const { gemini, done, report, claimId } = await run({ searchUrls: ['https://www.facebook.com/p/1', 'https://en.wikipedia.org/wiki/Treaty', 'https://www.scribd.com/doc/1'] });
    expect(done.job.status).toBe('research_failed');
    expect(report.decision).toBeNull();
    expect(report.result).toBeNull();
    expect(report.claim.outcome).toBe('research_failed');
    // The pages were found and quoted: the claim failed because of what the sources are, not because nothing was found.
    expect(report.evidence.some((e: any) => e.provenanceStatus === 'quote_verified')).toBe(true);
    for (const e of report.evidence) {
      expect(e.sourcePolicy.use).toBe('context_only');
      expect(e.countsAsIndependent).toBe(false);
    }
    const log = (await api('GET', `/claims/${claimId}/research-log`)).body.items;
    expect(log.some((l: any) => l.action === 'research_stopped' && /context only/.test(l.resultSummary))).toBe(true);
    expect(gemini.count('You are the Independent Judge')).toBe(0);
  });

  it('a government source decides; social media is shown as context and is not independent', async () => {
    const { gemini, done, report } = await run({ searchUrls: ['https://mess.gov.am/a', 'https://www.facebook.com/p/1', 'https://lib.armedu.am/b', 'https://unlisted.example.org/c'] });
    expect(done.job.status).toBe('completed');
    const byHost = (h: string) => report.evidence.find((e: any) => e.domain === h);
    expect(byHost('mess.gov.am').sourcePolicy).toMatchObject({ tier: 'high', category: 'government', use: 'evidence' });
    expect(byHost('lib.armedu.am').sourcePolicy).toMatchObject({ tier: 'high', category: 'education' });
    expect(byHost('facebook.com')).toMatchObject({ sourcePolicy: { use: 'context_only', category: 'social_media' }, countsAsIndependent: false });
    expect(byHost('unlisted.example.org').sourcePolicy ?? null).toBeNull();

    // The verdict rests on sources that can be evidence.
    const decisive = report.decision.decisiveEvidenceIds as string[];
    expect(decisive.length).toBeGreaterThan(0);
    for (const id of decisive) expect(report.evidence.find((e: any) => e.evidenceId === id).sourcePolicy?.use).not.toBe('context_only');
    expect(report.result.sourceCounts.independent).toBe(3); // gov.am, armedu.am, the unlisted site; not facebook

    // The agents were told what the database says.
    const assessor = gemini.calls.find((c) => c.systemInstruction.includes('assessing retrieved sources'))!;
    expect(assessor.prompt).toMatch(/credibility policy \(a ceiling for your rating\): low credibility, CONTEXT ONLY/);
    expect(assessor.prompt).toMatch(/credibility policy \(a ceiling for your rating\): high credibility, may be evidence/);
    expect(assessor.prompt).toMatch(/credibility policy: none \(site not in the database\)/);
    const judge = gemini.calls.find((c) => c.systemInstruction.includes('Independent Judge'))!;
    expect(judge.prompt).toMatch(/CONTEXT ONLY: background, not evidence that the claim is true/);
    expect(judge.prompt).toMatch(/unlisted site, capped at medium/);
  });

  it('an imported disinformation record makes an outlet context only', async () => {
    await replaceOrigin('euvsdisinfo', [rec('badnews.example.org', { origin: 'euvsdisinfo', tier: 'low', use: 'context_only', category: 'disinformation', attribution: true })]);
    const { done, report } = await run({ searchUrls: ['https://mess.gov.am/a', 'https://badnews.example.org/x'] });
    expect(done.job.status).toBe('completed');
    const bad = report.evidence.find((e: any) => e.domain === 'badnews.example.org');
    expect(bad.sourcePolicy).toMatchObject({ origin: 'euvsdisinfo', category: 'disinformation', use: 'context_only' });
    expect(bad.countsAsIndependent).toBe(false);
  });

  it('for a claim about who said what, an owner’s own account counts as evidence that it was said', async () => {
    const claim = 'The minister said that the treaty was signed in the capital in the spring of that year.';
    const { gemini, done, report } = await run({ attributed: true, searchUrls: ['https://www.facebook.com/minister/p/1', 'https://x.com/minister/s/1'] }, claim);
    expect(done.job.status).toBe('completed');
    expect(report.evidence.filter((e: any) => e.countsAsIndependent)).toHaveLength(2);
    expect(gemini.calls.find((c) => c.systemInstruction.includes('Independent Judge'))!.prompt).toMatch(/speaks for its owner/);
  });

  it('the same sources fail when the claim is not about who said what', async () => {
    const { done } = await run({ attributed: false, searchUrls: ['https://www.facebook.com/minister/p/1', 'https://x.com/minister/s/1'] });
    expect(done.job.status).toBe('research_failed');
  });
});
