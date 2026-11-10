// Pedagogue (PART 7.9, Phase 3): grade-level explanation, fallacies, source
// evaluation tips and exercises linked to the real claim and its evidence.
import { PedagogueOutputSchema } from '../../../shared/agents';
import type { DebateMessage } from '../../../shared/schemas';
import { agentCall } from '../../agents/call';
import { PEDAGOGUE, languageName, render } from '../../agents/prompts';
import { MAX_OUTPUT_TOKENS, MODELS, TEMPERATURE } from '../../config';
import { evidenceIdError } from '../../validation/contract';
import { C, col } from '../store';
import { loadTopic } from '../topic';
import type { StageContext, StageResult } from '../types';
import { formatEvidence } from './debate';
import { loadEvidence } from './research';

export async function runPedagogue(ctx: StageContext): Promise<StageResult> {
  const claim = ctx.claim!;
  const topic = await loadTopic(claim);
  const [evidence, decisionSnap, msgSnap] = await Promise.all([
    loadEvidence(claim.claimId),
    col(C.decisions).doc(`${claim.claimId}_judge`).get(),
    col(C.messages).where('debateId', '==', topic.debateId).get(),
  ]);
  const decision = decisionSnap.data()!;
  const messages = msgSnap.docs.map((d) => d.data() as DebateMessage).sort((a, b) => a.order - b.order);
  const usable = evidence.filter((e) => e.provenanceStatus !== 'retrieval_failed');
  const known = new Set(usable.map((e) => e.evidenceId));
  const argIds = new Set(messages.filter((m) => m.argumentId).map((m) => m.argumentId!));

  const out = await agentCall({
    ctx,
    topic,
    schema: PedagogueOutputSchema,
    model: MODELS.fast,
    system: render(PEDAGOGUE, { GRADE: String(ctx.job.gradeLevel ?? 9), LANGUAGE: languageName(ctx.job.outputLanguage) }),
    body: [
      `VERDICT: ${decision.verdict} (basis: ${decision.verdictBasis}; evidence strength: ${decision.evidenceStrength})`,
      `JUDGE REASONING: I choose the ${decision.winner === 'DEFENDER' ? 'Defender' : 'Prosecutor'} because ${decision.reasoning}`,
      `ESTABLISHED: ${decision.whatWasEstablished.join(' | ') || 'none'}`,
      `NOT ESTABLISHED: ${decision.whatWasNotEstablished.join(' | ') || 'none'}`,
      `EVIDENCE:\n${formatEvidence(usable)}`,
      `ARGUMENTS:\n${messages.filter((m) => m.argumentId).map((m) => `${m.argumentId}: ${m.content}`).join('\n')}`,
    ].join('\n\n'),
    temperature: TEMPERATURE.pedagogue,
    maxOutputTokens: MAX_OUTPUT_TOKENS.pedagogue,
    postValidate: (v) => {
      const ids = [...v.exercises.flatMap((e) => e.evidenceIds), ...v.sourceEvaluationTips.flatMap((t) => (t.evidenceId ? [t.evidenceId] : []))];
      const bad = v.fallacies.filter((f) => f.argumentId && !argIds.has(f.argumentId)).map((f) => f.argumentId);
      const badIdx = v.exercises.filter((e) => e.correctIndex >= e.options.length);
      return (
        evidenceIdError(ids, known) ??
        (bad.length ? `Unknown argument IDs in fallacies: ${bad.join(', ')}` : null) ??
        (badIdx.length ? 'correctIndex must point to an existing option' : null)
      );
    },
  });

  const explanationId = claim.claimId;
  return {
    outputRef: `educationalExplanations/${explanationId}`,
    apply: (tx) => {
      tx.set(col(C.explanations).doc(explanationId), {
        explanationId,
        claimId: claim.claimId,
        jobId: ctx.job.jobId,
        userId: ctx.job.userId,
        language: ctx.job.outputLanguage,
        gradeLevel: ctx.job.gradeLevel,
        explanation: out.explanation,
        keyLesson: out.keyLesson,
        fallacies: out.fallacies,
        sourceEvaluationTips: out.sourceEvaluationTips,
        createdAtMs: Date.now(),
      });
      out.exercises.forEach((e, i) => {
        const exerciseId = `${claim.claimId}_x${i + 1}`;
        tx.set(col(C.exercises).doc(exerciseId), {
          exerciseId,
          claimId: claim.claimId,
          jobId: ctx.job.jobId,
          userId: ctx.job.userId,
          classroomId: ctx.job.classroomId,
          topicStatement: topic.topicStatement,
          question: e.question,
          options: e.options,
          correctIndex: e.correctIndex,
          explanation: e.explanation,
          evidenceIds: e.evidenceIds,
          attempt: null,
          createdAtMs: Date.now(),
        });
      });
    },
    events: [
      {
        type: 'pedagogue_lesson',
        agentType: 'pedagogue',
        ref: { collection: 'educationalExplanations', id: explanationId },
        summary: out.keyLesson,
        data: { exercises: out.exercises.length },
      },
    ],
  };
}
