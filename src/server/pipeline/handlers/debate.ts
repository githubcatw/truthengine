// Debate engine (PART 11.2). Each step reads only persisted output of earlier
// steps; the two agents within a step run concurrently.
import type { Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import {
  ChallengeReassessOutputSchema,
  ChallengesOutputSchema,
  FinalOutputSchema,
  InitialArgumentsOutputSchema,
  ReassessOutputSchema,
  ResponseFinalOutputSchema,
  ResponsesOutputSchema,
} from '../../../shared/agents';
import {
  STEP_ROUND,
  type DebateMessage,
  type DebateSide,
  type DebateStep,
  type DebateTopic,
  type EvidenceRecord,
  type MessageType,
} from '../../../shared/schemas';
import { agentCall } from '../../agents/call';
import { DEFENDER, PROSECUTOR, STEP_INSTRUCTIONS, languageName, render } from '../../agents/prompts';
import { wrapUntrusted } from '../../ai/untrusted';
import { MAX_OUTPUT_TOKENS, MODELS, TEMPERATURE } from '../../config';
import { evidenceIdError, excerptLabel, normalizeWhitespace } from '../../validation/contract';
import { debateSteps, stageKeys } from '../plan';
import { C, col, stageRef, type EventInput } from '../store';
import { loadTopic } from '../topic';
import type { ClaimDoc, StageContext, StageResult, StageRunDoc } from '../types';
import { loadEvidence } from './research';

export interface ChallengeDoc {
  challengeId: string; // CD-1 (by Defender) / CP-1 (by Prosecutor)
  debateId: string;
  claimId: string;
  jobId: string;
  userId: string;
  challengerAgent: DebateSide;
  challengedArgumentId: string;
  challengingArgumentId: string; // the challenge label itself
  challengeType: string;
  explanation: string;
  evidenceIds: string[];
  response: string | null;
  responseEvidenceIds: string[];
  outcome: 'pending' | 'accepted' | 'rebutted' | 'unanswered';
}

const SIDES: DebateSide[] = ['defender', 'prosecutor'];
const opponent = (s: DebateSide): DebateSide => (s === 'defender' ? 'prosecutor' : 'defender');
const argPrefix = (s: DebateSide) => (s === 'defender' ? 'D' : 'P');
const challengePrefix = (s: DebateSide) => (s === 'defender' ? 'CD' : 'CP');

/** At most two sentences: counts sentence breaks followed by an upper-case letter (Latin, Cyrillic, Armenian). */
export function sentenceCount(text: string): number {
  return text.trim().split(/(?<=[.!?։])\s+(?=[\p{Lu}])/u).filter(Boolean).length;
}

/** Retrieved content exists for at least one cited record (otherwise: unsupported_assertion). */
export function isSupported(evidenceIds: string[], byId: Map<string, EvidenceRecord>): boolean {
  return evidenceIds.some((id) => {
    const e = byId.get(id);
    return e && (e.provenanceStatus === 'quote_verified' || e.provenanceStatus === 'fetched');
  });
}

export function positionResearchResult(side: DebateSide, evidence: EvidenceRecord[]): 'found' | 'nothing_found' {
  const want = side === 'defender' ? 'supports' : 'contradicts';
  return evidence.some((e) => e.foundByAgent === side && e.provenanceStatus === 'quote_verified' && e.provisionalRelation === want)
    ? 'found'
    : 'nothing_found';
}

export function formatEvidence(evidence: EvidenceRecord[]): string {
  return evidence
    .map((e) => {
      const lines = [
        `[${e.evidenceId}] ${excerptLabel(e.provenanceStatus)} | title: ${e.sourceTitle ?? 'unknown'} | organisation: ${e.sourceOrganization ?? 'unknown'} | domain: ${e.domain} | type: ${e.sourceType} | published: ${e.publicationDate ?? 'unknown'}${e.excerptLocation ? ` | location: ${e.excerptLocation}` : ''}`,
      ];
      if (e.qualityAssessment) {
        const q = e.qualityAssessment;
        lines.push(
          `  quality: credibility ${q.credibility.rating}; currency ${q.currency.rating}; methodology ${q.methodology.rating}; independence ${q.independence.rating}; relevance ${q.relevance.rating}`,
        );
      }
      if (e.provisionalRelation) {
        lines.push(`  Researcher's PROVISIONAL label: ${e.provisionalRelation}, ${e.directness ?? 'unknown'}; conditions match: ${e.conditionsMatch ?? 'unknown'}${e.conditionsNote ? ` (${e.conditionsNote})` : ''}`);
      }
      if (e.originalSourceId) lines.push(`  repeats primary source: ${e.originalSourceId} (not independent)`);
      if (e.trustedSource) lines.push(`  listed in trusted-sources registry: ${e.trustedSource.name} (${e.trustedSource.verificationStatus}) — not proof of correctness`);
      if (e.provenanceStatus === 'retrieval_failed') lines.push(`  retrieval failed: ${e.failureReason}`);
      if (e.excerpt) lines.push(`  verified excerpt:\n${wrapUntrusted('web_page', e.excerpt, e.evidenceId)}`);
      else if (e.snippet) lines.push(`  search snippet (NOT a verified quotation):\n${wrapUntrusted('search_snippet', e.snippet, e.evidenceId)}`);
      return lines.join('\n');
    })
    .join('\n');
}

async function loadDebate(debateId: string) {
  const [msgSnap, chSnap] = await Promise.all([
    col(C.messages).where('debateId', '==', debateId).get(),
    col(C.challenges).where('debateId', '==', debateId).get(),
  ]);
  const messages = msgSnap.docs.map((d) => d.data() as DebateMessage).sort((a, b) => a.order - b.order);
  const challenges = chSnap.docs.map((d) => d.data() as ChallengeDoc).sort((a, b) => a.challengeId.localeCompare(b.challengeId));
  return { messages, challenges };
}

export function formatDebate(messages: DebateMessage[], challenges: ChallengeDoc[]): string {
  const lines = messages.map((m) => {
    const who = m.agentType === 'defender' ? 'DEFENDER' : 'PROSECUTOR';
    const id = m.argumentId ? `${m.argumentId} ` : '';
    const refs = m.referencedEvidenceIds.length ? ` [evidence: ${m.referencedEvidenceIds.join(', ')}]` : '';
    const flag = m.unsupportedAssertion ? ' [UNSUPPORTED: no retrieved source]' : '';
    const target = m.referencedArgumentIds.length ? ` (re: ${m.referencedArgumentIds.join(', ')})` : '';
    return `R${m.roundNumber} ${who} ${m.messageType} ${id}${target}: ${m.content}${refs}${flag}`;
  });
  const open = challenges.filter((c) => c.outcome === 'pending');
  if (open.length) lines.push(`Open challenges: ${open.map((c) => `${c.challengeId}→${c.challengedArgumentId}`).join(', ')}`);
  return lines.join('\n');
}

const argumentsOf = (messages: DebateMessage[], side: DebateSide) =>
  messages.filter((m) => m.agentType === side && m.messageType === 'argument' && m.argumentId);

function stanceOf(messages: DebateMessage[], side: DebateSide): string {
  const last = [...messages].reverse().find((m) => m.agentType === side && typeof m.details.stance === 'string');
  return (last?.details.stance as string | undefined) ?? 'maintains';
}

// ---------------------------------------------------------------------------

interface SideOutput {
  side: DebateSide;
  value: Record<string, unknown>;
}

function schemaFor(step: DebateStep): z.ZodTypeAny {
  switch (step) {
    case 'r1_initial':
      return InitialArgumentsOutputSchema;
    case 'r2a_challenges':
      return ChallengesOutputSchema;
    case 'r2b_responses':
      return ResponsesOutputSchema;
    case 'r3_reassess':
      return ReassessOutputSchema;
    case 'r4_final':
      return FinalOutputSchema;
    case 'r2_challenge_reassess':
      return ChallengeReassessOutputSchema;
    case 'r3_response_final':
      return ResponseFinalOutputSchema;
  }
}

export function validateSideOutput(
  step: DebateStep,
  side: DebateSide,
  v: Record<string, unknown>,
  ctx: { byId: Map<string, EvidenceRecord>; messages: DebateMessage[]; challenges: ChallengeDoc[] },
): string | null {
  const known = new Set(ctx.byId.keys());
  const cited: string[] = [];
  const problems: string[] = [];
  const opp = new Set(argumentsOf(ctx.messages, opponent(side)).map((m) => m.argumentId!));
  const allArgs = new Set(argumentsOf(ctx.messages, 'defender').concat(argumentsOf(ctx.messages, 'prosecutor')).map((m) => m.argumentId!));

  const args = (v.arguments as Array<{ text: string; evidenceIds: string[] }> | undefined) ?? [];
  for (const [i, a] of args.entries()) {
    cited.push(...a.evidenceIds);
    if (sentenceCount(a.text) > 2) problems.push(`argument ${i + 1} has more than two sentences`);
  }
  const assessments = (v.evidenceAssessments as Array<{ evidenceId: string; quotedPassage: string }> | undefined) ?? [];
  for (const a of assessments) {
    cited.push(a.evidenceId);
    const e = ctx.byId.get(a.evidenceId);
    const text = normalizeWhitespace(e?.excerpt ?? e?.snippet ?? '');
    if (e && !text.includes(normalizeWhitespace(a.quotedPassage))) problems.push(`quotedPassage for ${a.evidenceId} is not copied verbatim from that record`);
  }
  const challenges = (v.challenges as Array<{ targetArgumentId: string; evidenceIds: string[]; text: string }> | undefined) ?? [];
  for (const c of challenges) {
    cited.push(...c.evidenceIds);
    if (!opp.has(c.targetArgumentId)) problems.push(`challenge targets ${c.targetArgumentId}, which is not an opponent argument`);
    if (sentenceCount(c.text) > 2) problems.push('a challenge has more than two sentences');
  }
  if (v.responses) {
    const mine = new Set(ctx.challenges.filter((c) => c.challengerAgent === opponent(side)).map((c) => c.challengeId));
    const answered = (v.responses as Array<{ challengeId: string; evidenceIds: string[] }>).map((r) => r.challengeId);
    for (const r of v.responses as Array<{ evidenceIds: string[] }>) cited.push(...r.evidenceIds);
    const extra = answered.filter((id) => !mine.has(id));
    const missing = [...mine].filter((id) => !answered.includes(id));
    if (extra.length) problems.push(`responses to unknown challenges: ${extra.join(', ')}`);
    if (missing.length) problems.push(`respond to every challenge directed at you; missing: ${missing.join(', ')}`);
  }
  const re = v.reassessment as { survivedArgumentIds: string[]; failedArgumentIds: string[]; evidenceThatChangedView: string[] } | undefined;
  if (re) {
    cited.push(...re.evidenceThatChangedView);
    const bad = [...re.survivedArgumentIds, ...re.failedArgumentIds].filter((id) => !allArgs.has(id));
    if (bad.length) problems.push(`unknown argument IDs in reassessment: ${bad.join(', ')}`);
  }
  const fin = v.final as { opponentStrongestArgumentId: string | null; evidenceIds: string[] } | undefined;
  if (fin) {
    cited.push(...fin.evidenceIds);
    if (fin.opponentStrongestArgumentId && !opp.has(fin.opponentStrongestArgumentId)) {
      problems.push(`opponentStrongestArgumentId ${fin.opponentStrongestArgumentId} is not an opponent argument`);
    }
  }
  const idErr = evidenceIdError(cited, known);
  if (idErr) problems.push(idErr);
  void step;
  return problems.length ? problems.join('; ') : null;
}

function buildBody(
  step: DebateStep,
  side: DebateSide,
  evidence: EvidenceRecord[],
  messages: DebateMessage[],
  challenges: ChallengeDoc[],
): string {
  const parts = [`EVIDENCE (the only sources you may cite):\n${formatEvidence(evidence)}`];
  if (step === 'r1_initial') {
    parts.push(`POSITION_RESEARCH: your position-specific research ${positionResearchResult(side, evidence) === 'found' ? 'found verified evidence for your position' : 'found nothing labelled as supporting your position under the most literal reading; check the evidence for other reasonable readings before conceding'}.`);
  } else {
    const oppArgs = argumentsOf(messages, opponent(side));
    if (step === 'r2a_challenges' || step === 'r2_challenge_reassess') {
      parts.push(`OPPONENT ROUND 1 ARGUMENTS:\n${oppArgs.map((m) => `${m.argumentId}: ${m.content} [evidence: ${m.referencedEvidenceIds.join(', ') || 'none'}]${m.unsupportedAssertion ? ' [UNSUPPORTED]' : ''}`).join('\n') || '(none)'}`);
      parts.push(`YOUR ROUND 1 ARGUMENTS:\n${argumentsOf(messages, side).map((m) => `${m.argumentId}: ${m.content}`).join('\n') || '(none)'}`);
    } else if (step === 'r2b_responses' || step === 'r3_response_final') {
      const directed = challenges.filter((c) => c.challengerAgent === opponent(side));
      parts.push(`CHALLENGES DIRECTED AT YOU:\n${directed.map((c) => `${c.challengeId} (on ${c.challengedArgumentId}, ${c.challengeType}): ${c.explanation} [evidence: ${c.evidenceIds.join(', ') || 'none'}]`).join('\n') || '(none — return an empty responses list)'}`);
      parts.push(`DEBATE SO FAR:\n${formatDebate(messages, challenges)}`);
    } else {
      parts.push(`COMPLETE DEBATE SO FAR:\n${formatDebate(messages, challenges)}`);
    }
  }
  parts.push(STEP_INSTRUCTIONS[step]);
  return parts.join('\n\n');
}

function toMessages(
  step: DebateStep,
  side: DebateSide,
  v: Record<string, unknown>,
  base: { debateId: string; claimId: string; jobId: string; userId: string },
  byId: Map<string, EvidenceRecord>,
  orderStart: number,
  challengesForSide: ChallengeDoc[],
): { messages: DebateMessage[]; newChallenges: ChallengeDoc[]; responseUpdates: Array<{ challengeId: string; patch: Partial<ChallengeDoc> }> } {
  const roundNumber = STEP_ROUND[step];
  const messages: DebateMessage[] = [];
  const newChallenges: ChallengeDoc[] = [];
  const responseUpdates: Array<{ challengeId: string; patch: Partial<ChallengeDoc> }> = [];
  let order = orderStart;
  const push = (messageType: MessageType, content: string, extra: Partial<DebateMessage>) => {
    const n = messages.length + 1;
    messages.push({
      messageId: `${base.debateId}_${step}_${side}_${n}`,
      ...base,
      agentType: side,
      roundNumber,
      stepName: step,
      messageType,
      argumentId: null,
      referencedArgumentIds: [],
      referencedEvidenceIds: [],
      content,
      details: {},
      unsupportedAssertion: false,
      order: order++,
      ...extra,
    });
  };

  if (step === 'r1_initial') {
    const out = v as z.infer<typeof InitialArgumentsOutputSchema>;
    push('evidence_assessment', out.summary, {
      referencedEvidenceIds: out.evidenceAssessments.map((a) => a.evidenceId),
      details: {
        stance: out.stance,
        concessionNote: out.concessionNote,
        positionResearchResult: positionResearchResult(side, [...byId.values()]),
        evidenceAssessments: out.evidenceAssessments,
      },
    });
    out.arguments.forEach((a, i) =>
      push('argument', a.text, {
        argumentId: `${argPrefix(side)}-${i + 1}`,
        referencedEvidenceIds: a.evidenceIds,
        unsupportedAssertion: !isSupported(a.evidenceIds, byId),
      }),
    );
  }
  const chs = (v.challenges as z.infer<typeof ChallengesOutputSchema>['challenges'] | undefined) ?? [];
  chs.forEach((c, i) => {
    const challengeId = `${challengePrefix(side)}-${i + 1}`;
    const needsEvidence = ['contradicted', 'weak_source', 'wrong_conditions'].includes(c.challengeType);
    push('challenge', c.text, {
      argumentId: challengeId,
      referencedArgumentIds: [c.targetArgumentId],
      referencedEvidenceIds: c.evidenceIds,
      details: { challengeType: c.challengeType },
      unsupportedAssertion: needsEvidence && !isSupported(c.evidenceIds, byId),
    });
    newChallenges.push({
      challengeId,
      ...base,
      challengerAgent: side,
      challengedArgumentId: c.targetArgumentId,
      challengingArgumentId: challengeId,
      challengeType: c.challengeType,
      explanation: c.text,
      evidenceIds: c.evidenceIds,
      response: null,
      responseEvidenceIds: [],
      outcome: 'pending',
    });
  });
  const responses = (v.responses as z.infer<typeof ResponsesOutputSchema>['responses'] | undefined) ?? [];
  for (const r of responses) {
    const ch = challengesForSide.find((c) => c.challengeId === r.challengeId);
    push('response', r.text, {
      referencedArgumentIds: [r.challengeId, ...(ch ? [ch.challengedArgumentId] : [])],
      referencedEvidenceIds: r.evidenceIds,
      details: { accepts: r.accepts },
      unsupportedAssertion: !r.accepts && r.evidenceIds.length > 0 && !isSupported(r.evidenceIds, byId),
    });
    responseUpdates.push({
      challengeId: r.challengeId,
      patch: { response: r.text, responseEvidenceIds: r.evidenceIds, outcome: r.accepts ? 'accepted' : 'rebutted' },
    });
  }
  const re = v.reassessment as z.infer<typeof ReassessOutputSchema>['reassessment'] | undefined;
  if (re) {
    push('reassessment', re.note, {
      referencedArgumentIds: [...re.survivedArgumentIds, ...re.failedArgumentIds],
      referencedEvidenceIds: re.evidenceThatChangedView,
      details: { ...re },
    });
  }
  const fin = v.final as z.infer<typeof FinalOutputSchema>['final'] | undefined;
  if (fin) {
    push('final_position', fin.finalAssessment, {
      referencedArgumentIds: fin.opponentStrongestArgumentId ? [fin.opponentStrongestArgumentId] : [],
      referencedEvidenceIds: fin.evidenceIds,
      details: { stance: fin.stance, acknowledgement: fin.acknowledgement, opponentStrongestArgumentId: fin.opponentStrongestArgumentId },
    });
  }
  return { messages, newChallenges, responseUpdates };
}

/** Steps between Round 1 and the final step are skipped when an agent honestly concedes (PART 10.5 rule 4). */
export function stepsToSkipAfterConcession(claim: ClaimDoc): DebateStep[] {
  const steps = debateSteps(claim);
  return steps.slice(1, -1) as DebateStep[];
}

export function runDebateStep(step: DebateStep) {
  return async (ctx: StageContext): Promise<StageResult> => {
    const claim = ctx.claim!;
    const topic: DebateTopic = await loadTopic(claim);
    const evidence = (await loadEvidence(claim.claimId)).filter((e) => e.provenanceStatus !== 'retrieval_failed');
    const byId = new Map(evidence.map((e) => [e.evidenceId, e]));
    const { messages, challenges } = await loadDebate(topic.debateId);
    const base = { debateId: topic.debateId, claimId: claim.claimId, jobId: ctx.job.jobId, userId: ctx.job.userId };
    const language = languageName(ctx.job.outputLanguage);

    const outputs: SideOutput[] = await Promise.all(
      SIDES.map(async (side) => {
        const value = await agentCall({
          ctx,
          topic,
          schema: schemaFor(step),
          model: MODELS.fast,
          system: render(side === 'defender' ? DEFENDER : PROSECUTOR, { LANGUAGE: language }),
          body: buildBody(step, side, evidence, messages, challenges),
          temperature: TEMPERATURE.debate,
          maxOutputTokens: MAX_OUTPUT_TOKENS.debate,
          postValidate: (v) => validateSideOutput(step, side, v as Record<string, unknown>, { byId, messages, challenges }),
        });
        return { side, value: value as Record<string, unknown> };
      }),
    );

    let order = (messages.at(-1)?.order ?? 0) + 1;
    const newMessages: DebateMessage[] = [];
    const newChallenges: ChallengeDoc[] = [];
    const updates: Array<{ challengeId: string; patch: Partial<ChallengeDoc> }> = [];
    for (const o of outputs) {
      const r = toMessages(step, o.side, o.value, base, byId, order, challenges.filter((c) => c.challengerAgent === opponent(o.side)));
      order += r.messages.length;
      newMessages.push(...r.messages);
      newChallenges.push(...r.newChallenges);
      updates.push(...r.responseUpdates);
    }

    const conceded = step === 'r1_initial' && outputs.some((o) => (o.value.stance as string) === 'concedes');
    const skip = conceded ? stepsToSkipAfterConcession(claim) : [];
    const isFinalStep = step === 'r4_final' || step === 'r3_response_final';

    const events: EventInput[] = newMessages.map((m) => ({
      type: 'debate_message',
      agentType: m.agentType,
      ref: { collection: 'debateMessages', id: m.messageId },
      summary: m.content,
      data: {
        messageType: m.messageType,
        argumentId: m.argumentId,
        referencedArgumentIds: m.referencedArgumentIds,
        evidenceIds: m.referencedEvidenceIds,
        round: m.roundNumber,
        step,
        unsupported: m.unsupportedAssertion,
        stance: (m.details.stance as string | undefined) ?? null,
      },
    }));
    for (const s of skip) {
      events.push({ type: 'stage_completed', stageKey: stageKeys.debate(claim.claimId, s), data: { skipped: true, reason: 'concession' } });
    }

    return {
      outputRef: `debateMessages:${newMessages.length}`,
      apply: (tx: Transaction) => {
        for (const m of newMessages) tx.set(col(C.messages).doc(m.messageId), { ...m, createdAtMs: Date.now() });
        for (const c of newChallenges) tx.set(col(C.challenges).doc(`${topic.debateId}_${c.challengeId}`), c);
        for (const u of updates) tx.update(col(C.challenges).doc(`${topic.debateId}_${u.challengeId}`), u.patch);
        if (isFinalStep) {
          // Challenges that were never answered are recorded honestly.
          for (const c of challenges) {
            if (c.outcome === 'pending' && !updates.some((u) => u.challengeId === c.challengeId)) {
              tx.update(col(C.challenges).doc(`${topic.debateId}_${c.challengeId}`), { outcome: 'unanswered' });
            }
          }
        }
        for (const s of skip) {
          const run: StageRunDoc = {
            stageKey: stageKeys.debate(claim.claimId, s),
            status: 'skipped',
            leaseOwner: null,
            leaseExpiresAt: null,
            attempts: 0,
            nextRetryAt: null,
            startedAtMs: null,
            completedAtMs: Date.now(),
            durationMs: 0,
            aiCalls: 0,
            errorCode: null,
            errorMessage: null,
            outputRef: 'skipped_after_concession',
          };
          tx.set(stageRef(ctx.job.jobId, run.stageKey), run);
        }
        tx.update(col(C.debates).doc(topic.debateId), {
          status: isFinalStep ? 'debate_completed' : 'in_progress',
          defenderStance: stanceOf([...messages, ...newMessages], 'defender'),
          prosecutorStance: stanceOf([...messages, ...newMessages], 'prosecutor'),
        });
      },
      events,
    };
  };
}
