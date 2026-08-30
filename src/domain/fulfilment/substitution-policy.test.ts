import { describe, expect, it } from 'vitest';
import { evaluateSubstitution } from './substitution-policy';

describe('evaluateSubstitution', () => {
  it('blocks a dairy substitute for a vegan mandate', () => {
    const decision = evaluateSubstitution(['vegan'], ['vegetarian', 'contains-dairy']);

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain('SUBSTITUTE_VEGAN_FAILED');
  });

  it('requires every relevant hard constraint to survive replacement', () => {
    const decision = evaluateSubstitution(
      ['vegan', 'plastic-free', 'branded'],
      ['vegan', 'plastic-free'],
    );

    expect(decision.allowed).toBe(true);
    expect(decision.checks).toHaveLength(2);
  });
});
