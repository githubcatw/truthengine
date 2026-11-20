// Triage (PART 7.4): one cheap call that sets class, time sensitivity and plan.
import { TriageOutputSchema } from '../../../shared/agents';
import { agentCall } from '../../agents/call';
import { TRIAGE } from '../../agents/prompts';
import { MAX_OUTPUT_TOKENS, MODELS, TEMPERATURE } from '../../config';
import { C, col, stageDocId } from '../store';
import { loadTopic } from '../topic';
import type { StageContext, StageResult } from '../types';

export async function runTriage(ctx: StageContext): Promise<StageResult> {
  const claim = ctx.claim!;
  const topic = await loadTopic(claim);
  const out = await agentCall({
    ctx,
    topic,
    schema: TriageOutputSchema,
    model: MODELS.fast,
    system: TRIAGE,
    body: 'Classify the locked claim.',
    temperature: TEMPERATURE.triage,
    maxOutputTokens: MAX_OUTPUT_TOKENS.triage,
  });
  // "Run deeper investigation" always uses the complex budget and full debate mode.
  const complexityClass = ctx.job.deep ? 'complex' : out.complexityClass;
  const debateMode = ctx.job.deep || complexityClass === 'complex' ? 'full' : 'fast';
  const analysisId = `${claim.claimId}_${stageDocId(ctx.stageKey)}`;
  return {
    outputRef: `agentAnalyses/${analysisId}`,
    apply: (tx) => {
      tx.update(col(C.claims).doc(claim.claimId), {
        complexityClass,
        timeSensitivity: out.timeSensitivity,
        queryLanguages: out.queryLanguages,
        debateMode,
      });
      tx.update(col(C.debates).doc(topic.debateId), { mode: debateMode });
      tx.set(col(C.analyses).doc(analysisId), {
        analysisId,
        claimId: claim.claimId,
        jobId: ctx.job.jobId,
        userId: ctx.job.userId,
        agentType: 'triage',
        stageKey: ctx.stageKey,
        structuredOutput: out,
        status: 'completed',
        createdAtMs: Date.now(),
      });
    },
    events: [
      {
        type: 'triage_completed',
        agentType: 'triage',
        ref: { collection: 'agentAnalyses', id: analysisId },
        summary: out.rationale,
        data: { complexityClass, timeSensitivity: out.timeSensitivity, debateMode, deep: ctx.job.deep },
      },
    ],
  };
}
