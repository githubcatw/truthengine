import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { apiClient, clearEmulators, createUser, drive, fakeFetch, startServer, useGemini, type Api } from '../helpers/harness';
import { fakeGemini } from '../helpers/fakeGemini';

const fetchMock = vi.hoisted(() => ({ impl: null as null | ((u: string) => Promise<unknown>) }));
vi.mock('../../src/server/research/fetcher', async (orig) => {
  const real = await orig<typeof import('../../src/server/research/fetcher')>();
  return { ...real, fetchSource: (u: string) => fetchMock.impl!(u) };
});

const TEXT = 'The treaty was signed in the capital in the spring of that year. In my opinion it was the best treaty ever written.';

let server: Server;
let base: string;
let api: Api;

beforeAll(async () => {
  ({ server, url: base } = await startServer());
});
afterAll(() => server.close());
beforeEach(async () => {
  await clearEmulators();
  fetchMock.impl = fakeFetch() as never;
  const u = await createUser(`student${Date.now()}@example.com`);
  api = apiClient(base, u.token);
});

async function submitAndConfirm(text = TEXT) {
  const created = await api('POST', '/verifications', { text, idempotencyKey: `key-${Math.random()}` });
  expect(created.status).toBe(200);
  const jobId = created.body.jobId as string;
  const awaiting = await drive(api, jobId);
  expect(awaiting.job.currentStage).toBe('awaiting_confirmation');
  const claims = awaiting.claims as Array<{ claimId: string; status: string }>;
  const selections = claims.map((c) => ({ claimId: c.claimId, selected: c.status !== 'not_verifiable' }));
  const confirmed = await api('POST', `/verifications/${jobId}/confirm`, { claims: selections });
  expect(confirmed.status).toBe(200);
  return { jobId, claims };
}

describe('end-to-end: submit text → confirm → research → debate → judge → result', () => {
  it('produces a binary verdict backed by quote_verified evidence and persists it', async () => {
    const gemini = fakeGemini();
    useGemini(gemini);
    const { jobId, claims } = await submitAndConfirm();
    // The opinion sentence is not_verifiable and cannot be selected.
    expect(claims.filter((c) => c.status === 'not_verifiable')).toHaveLength(1);

    const done = await drive(api, jobId);
    expect(done.job.status).toBe('completed');
    const claimId = done.job.claimSummaries[0].claimId as string;

    // Refresh: the same stored result comes back.
    const report = await api('GET', `/claims/${claimId}`);
    expect(report.status).toBe(200);
    const r = report.body;
    expect(['CORRECT', 'WRONG']).toContain(r.decision.verdict);
    expect(r.decision.verdict).toBe('CORRECT');
    expect(r.decision.verdictBasis).toBe('established');
    expect(r.result.verdict).toBe(r.decision.verdict);
    const verified = r.evidence.filter((e: any) => e.provenanceStatus === 'quote_verified');
    expect(verified.length).toBeGreaterThan(0);
    for (const id of r.decision.decisiveEvidenceIds) {
      expect(r.evidence.find((e: any) => e.evidenceId === id).provenanceStatus).toBe('quote_verified');
    }
    // Fast mode (basic): three debate steps, arguments D-1/P-1 stored.
    expect(r.debate.mode).toBe('fast');
    expect(r.messages.some((m: any) => m.argumentId === 'D-1')).toBe(true);
    expect(r.messages.some((m: any) => m.argumentId === 'P-1')).toBe(true);
    expect(r.challenges.length).toBeGreaterThan(0);
    expect(r.explanation.keyLesson).toBeTruthy();
    // The not_verifiable claim never reached the Judge.
    const judgeCalls = gemini.calls.filter((c) => c.systemInstruction.includes('Independent Judge'));
    expect(judgeCalls).toHaveLength(1);
    expect(judgeCalls[0]!.prompt).not.toContain('In my opinion');

    // Every stage recorded duration and AI calls.
    const view = await api('GET', `/verifications/${jobId}`);
    expect(view.body.stages.every((s: any) => s.status === 'completed' || s.status === 'skipped')).toBe(true);
    expect(view.body.stages.find((s: any) => s.stageKey.startsWith('judge:')).aiCalls).toBe(1);

    // Events: every debate_message event points to a stored message with the same text.
    const events = (await api('GET', `/verifications/${jobId}/events?limit=500`)).body.items as any[];
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    for (const e of events.filter((x) => x.type === 'debate_message')) {
      const m = r.messages.find((mm: any) => mm.messageId === e.ref.id);
      expect(m.content.startsWith(e.summary)).toBe(true);
    }
    expect(events.some((e) => e.type === 'judge_decision' && e.ref.id === r.decision.decisionId)).toBe(true);

    // History lists the job.
    const history = await api('GET', '/verifications');
    expect(history.body.items.map((h: any) => h.jobId)).toContain(jobId);
  });

  it('debate steps run only after the previous step is persisted (prompts contain persisted IDs)', async () => {
    const gemini = fakeGemini();
    useGemini(gemini);
    const { jobId } = await submitAndConfirm();
    await drive(api, jobId);
    const r2 = gemini.calls.filter((c) => c.prompt.includes('Step: Round 2, challenge and reassessment'));
    expect(r2).toHaveLength(2);
    // Defender's challenge step received the Prosecutor's persisted Round 1 argument.
    expect(r2.find((c) => c.systemInstruction.includes('You are the Defender'))!.prompt).toContain('P-1:');
    const r3 = gemini.calls.filter((c) => c.prompt.includes('Step: Round 3, responses and final'));
    expect(r3.find((c) => c.systemInstruction.includes('You are the Prosecutor'))!.prompt).toMatch(/CD-1 \(on P-1/);
  });

  it('full mode runs five steps for complex claims', async () => {
    useGemini(fakeGemini({ complexity: 'complex' }));
    const { jobId } = await submitAndConfirm();
    const done = await drive(api, jobId, 120);
    expect(done.job.status).toBe('completed');
    const keys = done.stages.map((s: any) => s.stageKey.split(':').pop());
    for (const step of ['r1_initial', 'r2a_challenges', 'r2b_responses', 'r3_reassess', 'r4_final']) expect(keys).toContain(step);
  });

  it('an honest concession skips to final positions; the Judge still chooses a side', async () => {
    useGemini(fakeGemini({ prosecutorConcedes: true }));
    const { jobId } = await submitAndConfirm();
    const done = await drive(api, jobId);
    expect(done.job.status).toBe('completed');
    const skipped = done.stages.filter((s: any) => s.status === 'skipped').map((s: any) => s.stageKey);
    expect(skipped.some((k: string) => k.endsWith('r2_challenge_reassess'))).toBe(true);
    const report = (await api('GET', `/claims/${done.job.claimSummaries[0].claimId}`)).body;
    expect(['DEFENDER', 'PROSECUTOR']).toContain(report.decision.winner);
    // The conceding Prosecutor produced no arguments: no minimum is enforced.
    expect(report.messages.filter((m: any) => m.agentType === 'prosecutor' && m.messageType === 'argument')).toHaveLength(0);
  });

  it('WRONG with not_established is a valid outcome', async () => {
    useGemini(fakeGemini({ judgeWinner: 'PROSECUTOR' }));
    const { jobId } = await submitAndConfirm();
    const done = await drive(api, jobId);
    const report = (await api('GET', `/claims/${done.job.claimSummaries[0].claimId}`)).body;
    expect(report.decision.verdict).toBe('WRONG');
    expect(report.decision.verdictBasis).toBe('not_established');
  });

  it('zero usable evidence ends as research_failed with no verdict', async () => {
    useGemini(fakeGemini());
    fetchMock.impl = fakeFetch(['*']) as never;
    const { jobId } = await submitAndConfirm();
    const done = await drive(api, jobId);
    expect(done.job.status).toBe('research_failed');
    const claimId = done.claims.find((c: any) => c.selected).claimId;
    const report = (await api('GET', `/claims/${claimId}`)).body;
    expect(report.decision).toBeNull();
    expect(report.result).toBeNull();
    expect(report.claim.outcome).toBe('research_failed');
    // Failed retrievals are recorded honestly with their reason.
    expect(report.evidence.every((e: any) => e.provenanceStatus !== 'quote_verified')).toBe(true);
    expect(report.evidence.some((e: any) => e.failureReason === 'blocked_403')).toBe(true);
    const log = (await api('GET', `/claims/${claimId}/research-log`)).body.items;
    expect(log.some((l: any) => l.action === 'retrieval_failed' && l.failureReason === 'blocked_403')).toBe(true);
  });

  it('a wrong topic-lock identifier is repaired once, then accepted', async () => {
    const gemini = fakeGemini({ badLock: { agent: 'triage', times: 1 } });
    useGemini(gemini);
    const { jobId } = await submitAndConfirm();
    const done = await drive(api, jobId);
    expect(done.job.status).toBe('completed');
    expect(gemini.count('You are the Triage step')).toBe(2);
    expect(gemini.calls.filter((c) => c.systemInstruction.includes('Triage'))[1]!.prompt).toContain('Topic lock mismatch on claimId');
  });

  it('a persistent topic-lock mismatch fails the stage (AI_OUTPUT_INVALID) and the claim', async () => {
    useGemini(fakeGemini({ badLock: { agent: 'judge', times: 5 } }));
    const { jobId } = await submitAndConfirm();
    const done = await drive(api, jobId);
    expect(done.job.status).toBe('failed');
    const judge = done.stages.find((s: any) => s.stageKey.startsWith('judge:'));
    expect(judge.status).toBe('failed');
    expect(judge.errorCode).toBe('AI_OUTPUT_INVALID');
    expect(judge.attempts).toBe(1);
  });

  it('the Judge cannot use unverified evidence as decisive (rejected and repaired)', async () => {
    // More results than the basic page budget (8): the rest stay search_metadata_only leads.
    const urls = Array.from({ length: 11 }, (_, i) => `https://site${i}.example.org/p`);
    const gemini = fakeGemini({ judgeCitesUnverifiedOnce: true, searchUrls: urls });
    useGemini(gemini);
    const { jobId } = await submitAndConfirm();
    const done = await drive(api, jobId);
    expect(done.job.status).toBe('completed');
    const judgeCalls = gemini.calls.filter((c) => c.systemInstruction.includes('Independent Judge'));
    expect(judgeCalls).toHaveLength(2);
    expect(judgeCalls[1]!.prompt).toContain('decisive evidence must be quote_verified');
  });

  it('duplicate submissions with the same idempotency key return the same job', async () => {
    useGemini(fakeGemini());
    const a = await api('POST', '/verifications', { text: TEXT, idempotencyKey: 'same-key-123' });
    const b = await api('POST', '/verifications', { text: TEXT, idempotencyKey: 'same-key-123' });
    expect(b.body.jobId).toBe(a.body.jobId);
    expect(b.body.duplicate).toBe(true);
  });

  it('new users have empty history', async () => {
    const h = await api('GET', '/verifications');
    expect(h.body.items).toEqual([]);
  });
});
