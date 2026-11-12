import { describe, expect, it } from 'vitest';
import { DEFENDER, languageLock, render, topicBlock } from '../../src/server/agents/prompts';

describe('debate language lock', () => {
  it('names the pinned debate language and tells the agent not to switch', () => {
    const lock = languageLock('hy');
    expect(lock).toContain('Armenian');
    expect(lock).toMatch(/locked for this whole debate/);
    expect(lock).not.toContain('English');
  });

  it('renders the debater system prompt in the pinned language', () => {
    expect(render(DEFENDER, { LANGUAGE: 'Armenian' })).toContain('Write all prose in Armenian.');
  });

  it('labels the claim language so it is not mistaken for the output language', () => {
    const block = topicBlock({
      claimId: 'c', debateId: 'd', topicHash: 'h', topicStatement: 's', originalText: 'o',
      context: { subject: 'other', language: 'en', gradeLevel: 9, surroundingExcerpt: null, timeframe: null, place: null, population: null },
      positions: { defender: 'argues the claim is CORRECT', prosecutor: 'argues the claim is WRONG', judge: 'neutral' },
    } as Parameters<typeof topicBlock>[0]);
    expect(block).toContain('claim text language: en');
    expect(block).not.toMatch(/^language:/m);
  });
});
