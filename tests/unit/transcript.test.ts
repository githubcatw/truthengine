import { describe, expect, it } from 'vitest';
import { groupTranscript } from '../../src/client/components/InvestigationStage';

const ev = (seq: number, type: string, groupId: string | null = null) => ({ seq, type, groupId, data: {} }) as never;

describe('transcript grouping', () => {
  it('groups consecutive research steps of the same stage, keeping real order', () => {
    const groups = groupTranscript([
      ev(1, 'stage_started', null),
      ev(2, 'research_log', 'research_search:c1'),
      ev(3, 'research_log', 'research_search:c1'),
      ev(4, 'research_log', 'research_read:c1'),
      ev(5, 'evidence_saved', null),
      ev(6, 'research_log', 'research_read:c1'),
    ]);
    expect(groups.map((g) => g.map((e: any) => e.seq))).toEqual([[1], [2, 3], [4], [5], [6]]);
  });
});
