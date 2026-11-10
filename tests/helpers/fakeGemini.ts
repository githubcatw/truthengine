// Test-only scripted Gemini client. It reads the real prompts the pipeline sends
// (topic block, evidence IDs, argument IDs, passages) and returns outputs that
// reference only what it was given, so the real validators are exercised.
// Never imported by the app (checked by tests/unit/bundle.test.ts).
import type { GeminiClient, GenerateRequest, GenerateResult } from '../../src/server/ai/gemini';

export const FAKE_MARKER = 'TE_TEST_FAKE_GEMINI_51c0';

export interface Scenario {
  complexity?: 'basic' | 'standard' | 'complex';
  timeSensitivity?: 'stable' | 'time_sensitive';
  judgeWinner?: 'DEFENDER' | 'PROSECUTOR';
  prosecutorConcedes?: boolean;
  /** Search results: URLs returned as grounding metadata for every search. */
  searchUrls?: string[];
  /** Return a wrong claimId on the first N agent calls of this kind. */
  badLock?: { agent: 'triage' | 'judge'; times: number };
  /** Judge cites a non-verified evidence ID as decisive on the first call. */
  judgeCitesUnverifiedOnce?: boolean;
  /** OCR: page numbers to report as unreadable. */
  unreadablePages?: number[];
  /** Audit candidates returned by the auditor (passages must exist in the document). */
  audit?: { unsourcedFigure?: string; referenceUrl?: { passage: string; url: string } };
}

const json = (v: unknown): GenerateResult => ({ text: JSON.stringify(v), groundingSources: [], webSearchQueries: [] });

function lockFrom(prompt: string) {
  const g = (k: string) => prompt.match(new RegExp(`^${k}: (.+)$`, 'm'))?.[1]?.trim() ?? '';
  return { claimId: g('claimId'), debateId: g('debateId'), topicHash: g('topicHash'), topicStatement: g('topicStatement') };
}

function untrustedBlocks(prompt: string): Array<{ label: string | null; text: string }> {
  const re = /<UNTRUSTED [^>]*?id="([a-f0-9]+)"(?: label="([^"]*)")?>\n([\s\S]*?)\n<\/UNTRUSTED id="\1">/g;
  const out: Array<{ label: string | null; text: string }> = [];
  for (const m of prompt.matchAll(re)) out.push({ label: m[2] ?? null, text: m[3]! });
  return out;
}

const sentences = (t: string) => t.split(/(?<=[.!?։])\s+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 4);

function verifiedEvidence(prompt: string): Array<{ id: string; text: string }> {
  const ids = [...prompt.matchAll(/^\[(E\d+)\] Verified excerpt/gm)].map((m) => m[1]!);
  const blocks = untrustedBlocks(prompt);
  return ids.map((id) => ({ id, text: blocks.find((b) => b.label === id)?.text ?? '' }));
}

const argIds = (prompt: string, prefix: 'D' | 'P') => [...new Set([...prompt.matchAll(new RegExp(`\\b(${prefix}-\\d+)\\b`, 'g'))].map((m) => m[1]!))];

export function fakeGemini(scenario: Scenario = {}): GeminiClient & { calls: GenerateRequest[]; count: (needle: string) => number } {
  const calls: GenerateRequest[] = [];
  const badLockLeft = { ...(scenario.badLock ?? { agent: 'triage', times: 0 }) };
  let judgeBadLeft = scenario.judgeCitesUnverifiedOnce ? 1 : 0;

  const client = {
    calls,
    count: (needle: string) => calls.filter((c) => c.systemInstruction.includes(needle)).length,
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      calls.push(req);
      const sys = req.systemInstruction;
      const p = req.prompt;
      const lock = lockFrom(p);
      const lk = { claimId: lock.claimId, debateId: lock.debateId, topicHash: lock.topicHash };

      if (req.googleSearch) {
        const urls = scenario.searchUrls ?? ['https://alpha.example.edu/a', 'https://beta.example.org/b', 'https://gamma.example.am/c'];
        return {
          text: 'Sources found.',
          groundingSources: urls.map((u) => ({ uri: u, title: new URL(u).hostname, snippets: [`Snippet about ${new URL(u).hostname}`] })),
          webSearchQueries: [],
        };
      }
      if (sys.includes('You are the Claim Extractor')) {
        const doc = untrustedBlocks(p)[0]?.text ?? '';
        return json({
          detectedLanguage: 'en',
          detectedSubject: 'world_history',
          claims: sentences(doc).map((s) => {
            const opinion = /^In my opinion/i.test(s);
            return {
              originalText: s,
              normalizedText: s,
              category: 'world_history',
              verifiable: !opinion,
              notVerifiableReason: opinion ? 'opinion' : null,
              ambiguityNote: null,
              contextExcerpt: null,
              timeframe: null,
              place: null,
              population: null,
              importance: 3,
              splitFrom: null,
            };
          }),
        });
      }
      if (sys.includes('You are the Triage step')) {
        const wrong = badLockLeft.agent === 'triage' && badLockLeft.times-- > 0;
        return json({
          ...lk,
          claimId: wrong ? 'someone-elses-claim' : lk.claimId,
          complexityClass: scenario.complexity ?? 'basic',
          timeSensitivity: scenario.timeSensitivity ?? 'stable',
          rationale: 'Single documented fact.',
          queryLanguages: ['en'],
        });
      }
      if (sys.includes('planning web searches')) {
        return json({
          ...lk,
          queries: [
            { track: 'neutral', query: `${lock.topicStatement} overview`, language: 'en' },
            { track: 'supporting', query: `${lock.topicStatement} evidence`, language: 'en' },
            { track: 'contradicting', query: `${lock.topicStatement} disputed`, language: 'en' },
          ],
        });
      }
      if (sys.includes('assessing retrieved sources')) {
        const refs = [...p.matchAll(/^SOURCE (S\d+)$/gm)].map((m) => m[1]!);
        const blocks = untrustedBlocks(p);
        return json({
          ...lk,
          sources: refs.map((ref) => {
            const first = blocks.find((b) => b.label?.startsWith(`${ref}-`));
            const excerpt = first ? (sentences(first.text)[0] ?? first.text.slice(0, 120)) : null;
            return {
              sourceRef: ref,
              usable: Boolean(first),
              rejectReason: first ? null : 'No relevant text.',
              sourceTitle: `Title ${ref}`,
              sourceOrganization: `Org ${ref}`,
              sourceType: 'textbook',
              publicationDate: null,
              excerpt,
              excerptPassageId: first?.label ?? null,
              repeatsPrimarySource: null,
              qualityAssessment: {
                credibility: { rating: 'high', rationale: 'Academic publisher.' },
                currency: { rating: 'medium', rationale: 'Recent edition.' },
                methodology: { rating: 'medium', rationale: 'Cites sources.' },
                independence: { rating: 'high', rationale: 'Independent.' },
                relevance: { rating: 'high', rationale: 'On topic.' },
              },
              provisionalRelation: 'supports',
              directness: 'direct',
              conditionsMatch: true,
              conditionsNote: null,
            };
          }),
        });
      }
      const isDef = sys.includes('You are the Defender');
      const isPro = sys.includes('You are the Prosecutor');
      if (isDef || isPro) {
        const me = isDef ? 'D' : 'P';
        const opp = isDef ? 'P' : 'D';
        const ev = verifiedEvidence(p);
        const e = ev[0];
        const concede = isPro && scenario.prosecutorConcedes;
        const oppArgs = argIds(p, opp);
        const final = {
          stance: concede ? 'concedes' : 'maintains',
          finalAssessment: concede ? 'The evidence supports the claim.' : 'My position stands on the cited evidence.',
          opponentStrongestArgumentId: oppArgs[0] ?? null,
          acknowledgement: 'The opponent cited relevant evidence.',
          evidenceIds: e ? [e.id] : [],
        };
        const reassessment = {
          stance: concede ? 'concedes' : 'maintains',
          survivedArgumentIds: argIds(p, me).slice(0, 1),
          failedArgumentIds: [],
          evidenceThatChangedView: [],
          remainingDisagreements: [],
          ownWeaknesses: ['Limited number of sources.'],
          note: 'Reassessed against the evidence.',
        };
        const challengeIds = [...(p.split('CHALLENGES DIRECTED AT YOU:')[1] ?? '').matchAll(/^(C[DP]-\d+) \(on/gm)].map((m) => m[1]!);
        const responses = challengeIds.map((id) => ({ challengeId: id, accepts: false, text: 'The cited excerpt addresses this.', evidenceIds: e ? [e.id] : [] }));
        const challenges = oppArgs.slice(0, 1).map((id) => ({ targetArgumentId: id, challengeType: 'overreach', text: `Argument ${id} goes beyond the excerpt.`, evidenceIds: [] }));

        if (p.includes('Step: Round 1, initial arguments')) {
          return json({
            ...lk,
            stance: concede ? 'concedes' : 'maintains',
            evidenceAssessments: e ? [{ evidenceId: e.id, relation: 'supports', directness: 'direct', conditionsMatch: true, quotedPassage: e.text.slice(0, 30), note: 'Direct statement.' }] : [],
            arguments: concede || !e ? [] : [{ text: isDef ? 'The verified excerpt states the claim directly.' : 'The excerpt does not cover every condition.', evidenceIds: [e.id] }],
            concessionNote: concede ? 'No evidence contradicts the claim.' : null,
            summary: 'Assessment of the evidence pool.',
          });
        }
        if (p.includes('Step: Round 2a')) return json({ ...lk, challenges });
        if (p.includes('Step: Round 2b')) return json({ ...lk, responses });
        if (p.includes('Step: Round 3, reassessment')) return json({ ...lk, reassessment });
        if (p.includes('Step: Round 4')) return json({ ...lk, final });
        if (p.includes('Step: Round 2, challenge and reassessment')) return json({ ...lk, challenges, reassessment });
        if (p.includes('Step: Round 3, responses and final')) return json({ ...lk, responses, final });
      }
      if (sys.includes('You are the Independent Judge')) {
        const wrongLock = badLockLeft.agent === 'judge' && badLockLeft.times-- > 0;
        const ev = verifiedEvidence(p);
        const winner = scenario.judgeWinner ?? 'DEFENDER';
        const allIds = [...p.matchAll(/^\[(E\d+)\]/gm)].map((m) => m[1]!);
        const unverified = allIds.find((id) => !ev.some((v) => v.id === id));
        const decisive = judgeBadLeft-- > 0 && unverified ? [unverified] : [ev[0]?.id ?? 'E1'];
        return json({
          ...lk,
          claimId: wrongLock ? 'another-claim' : lk.claimId,
          winner,
          verdict: winner === 'DEFENDER' ? 'CORRECT' : 'WRONG',
          verdictBasis: winner === 'DEFENDER' ? 'established' : 'not_established',
          reasoning: 'the verified excerpts directly establish the claim as worded.',
          whatWasEstablished: ['The core statement.'],
          whatWasNotEstablished: [],
          defender: { established: ['The core statement.'], failedToEstablish: [] },
          prosecutor: { established: [], failedToEstablish: ['A contradiction.'] },
          decisiveEvidenceIds: decisive,
          decisiveEvidenceRationale: 'Direct, credible and independent.',
          acceptedArgumentIds: argIds(p, 'D').slice(0, 1),
          rejectedArguments: argIds(p, 'P').slice(0, 1).map((id) => ({ argumentId: id, reason: 'unsupported', note: 'Not supported by the excerpts.' })),
          evidenceStrength: 'Limited',
          limitations: ['Few independent sources.'],
          studentConclusion: 'The sources agree with the claim.',
          believability: {
            whyBelievable: [{ text: 'It is stated in textbooks.', evidenceIds: ev[0] ? [ev[0].id] : [] }],
            whyMightBeWrong: [],
            canEstablish: [{ text: 'The core statement.', evidenceIds: ev[0] ? [ev[0].id] : [] }],
            cannotEstablish: [],
          },
        });
      }
      if (sys.includes('You are the Pedagogue')) {
        const ev = verifiedEvidence(p);
        return json({
          ...lk,
          explanation: 'Here is what the sources show.',
          keyLesson: 'Check the source of every statement.',
          fallacies: [],
          sourceEvaluationTips: [{ tip: 'Prefer academic sources.', evidenceId: ev[0]?.id ?? null }],
          exercises: [{ question: 'Which source was decisive?', options: ['A textbook', 'A blog'], correctIndex: 0, explanation: 'The textbook excerpt was verified.', evidenceIds: ev[0] ? [ev[0].id] : [] }],
        });
      }
      if (sys.includes('Quality and Citation Auditor')) {
        const a = scenario.audit ?? {};
        return json({
          references: a.referenceUrl ? [{ passage: a.referenceUrl.passage, kind: 'url', citationText: a.referenceUrl.url, doi: null, url: a.referenceUrl.url }] : [],
          quotations: [],
          unsourcedFigures: a.unsourcedFigure ? [{ passage: a.unsourcedFigure, explanation: 'A specific figure is given without a source.' }] : [],
          contradictions: [],
          editorial: [],
        });
      }
      if (sys.includes('You are the Content Extractor')) {
        const pages = [...p.matchAll(/pages ([\d, ]+) of the attached PDF/g)][0]?.[1]?.split(',').map((x) => Number(x.trim())) ?? [1];
        return json({
          detectedLanguage: 'en',
          pages: pages.map((n) => {
            const bad = scenario.unreadablePages?.includes(n);
            return { pageNumber: n, text: bad ? '' : `Scanned page ${n} says the harbour was dredged in the early spring.`, readable: !bad, warning: bad ? 'The scan is too blurry to read.' : null };
          }),
        });
      }
      throw new Error(`fakeGemini: unhandled request (${sys.slice(0, 60)})`);
    },
  };
  return client;
}
