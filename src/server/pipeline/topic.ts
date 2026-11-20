import { AppError } from '../errors';
import { computeTopicHash } from '../validation/contract';
import type { DebateTopic, Language } from '../../shared/schemas';
import { C, col } from './store';
import type { ClaimDoc, JobDoc } from './types';

export const debateIdFor = (claimId: string) => `${claimId}_debate`;

/** Builds the DebateTopic stored on the debate document at confirmation time. */
export function buildTopic(claim: ClaimDoc, job: JobDoc): DebateTopic {
  const debateId = debateIdFor(claim.claimId);
  return {
    claimId: claim.claimId,
    debateId,
    topicStatement: claim.normalizedText,
    originalText: claim.originalText,
    context: {
      subject: claim.subject,
      language: claim.language,
      gradeLevel: job.gradeLevel,
      surroundingExcerpt: claim.context.surroundingExcerpt,
      timeframe: claim.context.timeframe,
      place: claim.context.place,
      population: claim.context.population,
    },
    positions: {
      defender: 'argues the claim is CORRECT',
      prosecutor: 'argues the claim is WRONG',
      judge: 'neutral',
    },
    topicHash: computeTopicHash({ claimId: claim.claimId, debateId, topicStatement: claim.normalizedText }),
  };
}

export async function loadTopic(claim: ClaimDoc): Promise<DebateTopic> {
  return (await loadDebateSetup(claim, null)).topic;
}

/**
 * The locked topic plus the language the debate is written in. The language is
 * pinned on the debate document when the debate is created, so every round, the
 * Judge and the Pedagogue keep using it even if the user changes their locale.
 * Debates created before the language was pinned fall back to the job's language.
 */
export async function loadDebateSetup(claim: ClaimDoc, job: Pick<JobDoc, 'outputLanguage'> | null): Promise<{ topic: DebateTopic; language: Language }> {
  const snap = await col(C.debates).doc(debateIdFor(claim.claimId)).get();
  if (!snap.exists) throw new AppError('INTERNAL', 'The debate topic for this claim is missing.');
  const language = (snap.get('language') as Language | undefined) ?? job?.outputLanguage ?? claim.language;
  return { topic: snap.get('topic') as DebateTopic, language };
}
