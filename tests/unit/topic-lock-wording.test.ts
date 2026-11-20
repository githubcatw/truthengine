// PART 18: valid outputs that use synonyms or translated wording are NOT rejected;
// the topic lock is checked on identifiers only, never by keyword overlap.
import { describe, expect, it } from 'vitest';
import { agentCall } from '../../src/server/agents/call';
import { computeTopicHash } from '../../src/server/validation/contract';
import { TriageOutputSchema } from '../../src/shared/agents';
import type { DebateTopic } from '../../src/shared/schemas';

const topic: DebateTopic = {
  claimId: 'c1',
  debateId: 'c1_debate',
  topicStatement: 'The Matenadaran holds more than seventeen thousand manuscripts.',
  originalText: 'The Matenadaran holds more than seventeen thousand manuscripts.',
  context: { subject: 'armenian_history', language: 'en', gradeLevel: null, surroundingExcerpt: null, timeframe: null, place: null, population: null },
  positions: { defender: 'argues the claim is CORRECT', prosecutor: 'argues the claim is WRONG', judge: 'neutral' },
  topicHash: computeTopicHash({ claimId: 'c1', debateId: 'c1_debate', topicStatement: 'The Matenadaran holds more than seventeen thousand manuscripts.' }),
};

function ctxWith(rationale: string) {
  const calls: unknown[] = [];
  const client = {
    async embed() {
      return [];
    },
    async generate(req: unknown) {
      calls.push(req);
      return {
        text: JSON.stringify({ claimId: topic.claimId, debateId: topic.debateId, topicHash: topic.topicHash, complexityClass: 'basic', timeSensitivity: 'stable', rationale, queryLanguages: ['hy', 'en'] }),
        groundingSources: [],
        webSearchQueries: [],
      };
    },
  };
  return { ctx: { gemini: () => client, counter: { aiCalls: 0 } } as never, calls };
}

describe('topic lock and wording', () => {
  it.each([
    ['synonyms', 'The manuscript repository in Yerevan keeps a collection of ancient codices numbering in the tens of thousands.'],
    ['Armenian translation', 'Մատենադարանը պահում է ավելի քան տասնյոթ հազար ձեռագիր։'],
    ['Russian translation', 'В Матенадаране хранится более семнадцати тысяч рукописей.'],
  ])('accepts output written with %s on the first call', async (_label, rationale) => {
    const { ctx, calls } = ctxWith(rationale);
    const out = await agentCall({ ctx, topic, schema: TriageOutputSchema, model: 'm', system: 's', body: 'b', temperature: 0, maxOutputTokens: 100 });
    expect(out.rationale).toBe(rationale);
    expect(calls).toHaveLength(1);
  });
});
