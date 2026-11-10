import { AppError } from '../errors';
import { computeTopicHash } from '../validation/contract';
import type { DebateTopic } from '../../shared/schemas';
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
  const snap = await col(C.debates).doc(debateIdFor(claim.claimId)).get();
  if (!snap.exists) throw new AppError('INTERNAL', 'The debate topic for this claim is missing.');
  return snap.get('topic') as DebateTopic;
}
