import { describe, expect, it } from 'vitest';
import { VerdictSchema, isVerdictBasisConsistent, VerdictBasisSchema } from '../../src/shared/schemas';

describe('binary verdict', () => {
  it('accepts only CORRECT and WRONG', () => {
    expect(VerdictSchema.safeParse('CORRECT').success).toBe(true);
    expect(VerdictSchema.safeParse('WRONG').success).toBe(true);
    for (const bad of ['PARTIALLY_CORRECT', 'UNVERIFIABLE', 'UNCERTAIN', 'INSUFFICIENT_EVIDENCE', 'correct', '', null]) {
      expect(VerdictSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('CORRECT requires established; WRONG requires a non-established basis', () => {
    expect(isVerdictBasisConsistent('CORRECT', 'established')).toBe(true);
    for (const b of VerdictBasisSchema.options.filter((o) => o !== 'established')) {
      expect(isVerdictBasisConsistent('CORRECT', b)).toBe(false);
      expect(isVerdictBasisConsistent('WRONG', b)).toBe(true);
    }
    expect(isVerdictBasisConsistent('WRONG', 'established')).toBe(false);
  });
});
