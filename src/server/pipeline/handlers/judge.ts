// Independent Judge (PART 11.4). Strongest model, randomised position order,
// no agent confidence and no user/classroom information.
import { randomInt } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { JudgeOutputSchema, type JudgeOutput } from '../../../shared/agents';
import { isVerdictBasisConsistent, verdictForWinner, type DebateMessage, type EvidenceRecord } from '../../../shared/schemas';
import { agentCall } from '../../agents/call';
import { JUDGE, languageLock, languageName, render } from '../../agents/prompts';
import { MAX_OUTPUT_TOKENS, MODELS, TEMPERATURE } from '../../config';
import { isEvidenceGrade } from '../../../shared/credibility';
import { evidenceIdError } from '../../validation/contract';
import { C, col } from '../store';
import { loadDebateSetup } from '../topic';
import type { StageContext, StageResult } from '../types';
import { formatEvidence, type ChallengeDoc } from './debate';
import { independentCount, loadEvidence } from './research';

/** Deterministic Judge validator (PART 15). Returns an error string or null. */
export function validateJudge(
  v: JudgeOutput,
  evidence: EvidenceRecord[],
  argumentIds: Set<string>,
  attributionClaim = false,
): string | null {
  const problems: string[] = [];
  if (v.verdict !== verdictForWinner(v.winner)) problems.push(`winner ${v.winner} requires verdict ${verdictForWinner(v.winner)}`);
  if (!isVerdictBasisConsistent(v.verdict, v.verdictBasis)) {
    problems.push(v.verdict === 'CORRECT' ? 'CORRECT requires verdictBasis "established"' : 'WRONG cannot have verdictBasis "established"');
  }
  const known = new Set(evidence.map((e) => e.evidenceId));
  const cited = [
    ...v.decisiveEvidenceIds,
    ...Object.values(v.believability).flatMap((items) => items.flatMap((i) => i.evidenceIds)),
  ];
  const idErr = evidenceIdError(cited, known);
  if (idErr) problems.push(idErr);
  const notVerified = v.decisiveEvidenceIds.filter((id) => evidence.find((e) => e.evidenceId === id)?.provenanceStatus !== 'quote_verified');
  if (notVerified.length) problems.push(`decisive evidence must be quote_verified: ${notVerified.join(', ')}`);
  // A context-only site (social network, blog, file sharing, Wikipedia, known disinformation) cannot settle the verdict.
  const contextOnly = v.decisiveEvidenceIds.filter((id) => {
    const e = evidence.find((x) => x.evidenceId === id);
    return e && !isEvidenceGrade(e.sourcePolicy, attributionClaim);
  });
  if (contextOnly.length) problems.push(`decisive evidence cannot come from context-only sources: ${contextOnly.join(', ')}`);
  const badArgs = [...v.acceptedArgumentIds, ...v.rejectedArguments.map((r) => r.argumentId)].filter((id) => !argumentIds.has(id));
  if (badArgs.length) problems.push(`unknown argument IDs: ${badArgs.join(', ')}`);
  return problems.length ? problems.join('; ') : null;
}

function sideBlock(label: 'DEFENDER' | 'PROSECUTOR', messages: DebateMessage[], challenges: ChallengeDoc[]): string {
  const side = label === 'DEFENDER' ? 'defender' : 'prosecutor';
  const mine = messages.filter((m) => m.agentType === side);
  const lines = mine
    // Unsupported assertions are excluded from the Judge's consideration (PART 0.5 rule 4).
    .filter((m) => !m.unsupportedAssertion)
    .filter((m) => m.messageType !== 'evidence_assessment')
    .map((m) => `${m.argumentId ? `${m.argumentId} ` : ''}[R${m.roundNumber} ${m.messageType}${m.referencedArgumentIds.length ? ` re ${m.referencedArgumentIds.join(',')}` : ''}] ${m.content} [evidence: ${m.referencedEvidenceIds.join(', ') || 'none'}]${m.details.stance === 'concedes' ? ' (CONCEDES)' : ''}`);
  const ignored = mine.filter((m) => m.unsupportedAssertion && m.argumentId).map((m) => m.argumentId);
  const chal = challenges
    .filter((c) => c.challengerAgent === side)
    .map((c) => `${c.challengeId} on ${c.challengedArgumentId}: outcome ${c.outcome}`);
  return [
    `=== ${label} ===`,
    ...lines,
    ignored.length ? `Ignored as UNSUPPORTED (no retrieved source): ${ignored.join(', ')}` : '',
    chal.length ? `Challenge outcomes: ${chal.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runJudge(ctx: StageContext): Promise<StageResult> {
  const claim = ctx.claim!;
  const { topic, language } = await loadDebateSetup(claim, ctx.job);
  const evidence = await loadEvidence(claim.claimId);
  const [msgSnap, chSnap] = await Promise.all([
    col(C.messages).where('debateId', '==', topic.debateId).get(),
    col(C.challenges).where('debateId', '==', topic.debateId).get(),
  ]);
  const messages = msgSnap.docs.map((d) => d.data() as DebateMessage).sort((a, b) => a.order - b.order);
  const challenges = chSnap.docs.map((d) => d.data() as ChallengeDoc);
  const argumentIds = new Set(messages.filter((m) => m.argumentId).map((m) => m.argumentId!));
  const usable = evidence.filter((e) => e.provenanceStatus !== 'retrieval_failed');
  const attributionClaim = claim.attributionClaim ?? false;

  // Bias control: the order of the two positions is randomised.
  const defenderFirst = randomInt(2) === 0;
  const blocks = [sideBlock('DEFENDER', messages, challenges), sideBlock('PROSECUTOR', messages, challenges)];
  if (!defenderFirst) blocks.reverse();

  const out = await agentCall({
    ctx,
    topic,
    schema: JudgeOutputSchema,
    model: MODELS.judge,
    system: render(JUDGE, { LANGUAGE: languageName(language) }),
    body: [
      `EVIDENCE RECORDS (layer A provenance, layer B quality, layer C provisional relation):\n${formatEvidence(usable, attributionClaim)}`,
      ...blocks,
      'Decide the verdict.',
      languageLock(language),
    ].join('\n\n'),
    temperature: TEMPERATURE.judge,
    maxOutputTokens: MAX_OUTPUT_TOKENS.judge,
    postValidate: (v) => validateJudge(v, usable, argumentIds, attributionClaim),
  });

  const decisionId = `${claim.claimId}_judge`;
  const verified = evidence.filter((e) => e.provenanceStatus === 'quote_verified' && isEvidenceGrade(e.sourcePolicy, attributionClaim));
  const sourceCounts = {
    total: usable.length,
    organizations: new Set(usable.map((e) => e.sourceOrganization ?? e.domain)).size,
    verified: verified.length,
    independent: independentCount(evidence, attributionClaim),
  };
  const decision = {
    ...out,
    decisionId,
    jobId: ctx.job.jobId,
    userId: ctx.job.userId,
    positionOrder: defenderFirst ? 'defender_first' : 'prosecutor_first',
    createdAtMs: Date.now(),
  };
  const result = {
    resultId: claim.claimId,
    claimId: claim.claimId,
    jobId: ctx.job.jobId,
    userId: ctx.job.userId,
    topicStatement: topic.topicStatement,
    subject: claim.subject,
    language: claim.language,
    verdict: out.verdict,
    verdictBasis: out.verdictBasis,
    summary: out.studentConclusion,
    evidenceStrength: out.evidenceStrength,
    sourceCounts,
    cacheKey: claim.cacheKey,
    timeSensitivity: claim.timeSensitivity,
    completedAtMs: Date.now(),
    completedAt: FieldValue.serverTimestamp(),
  };

  return {
    outputRef: `judgeDecisions/${decisionId}`,
    apply: (tx) => {
      tx.set(col(C.decisions).doc(decisionId), decision);
      tx.set(col(C.results).doc(claim.claimId), result);
      tx.update(col(C.claims).doc(claim.claimId), { verdict: out.verdict });
      tx.update(col(C.debates).doc(topic.debateId), { status: 'judged' });
    },
    claimOutcome: { outcome: 'judged' },
    events: [
      {
        type: 'judge_decision',
        agentType: 'judge',
        ref: { collection: 'judgeDecisions', id: decisionId },
        summary: out.reasoning,
        data: {
          winner: out.winner,
          verdict: out.verdict,
          verdictBasis: out.verdictBasis,
          evidenceStrength: out.evidenceStrength,
          decisiveEvidenceIds: out.decisiveEvidenceIds,
        },
      },
    ],
  };
}
