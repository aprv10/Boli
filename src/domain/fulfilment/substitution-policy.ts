import type { HardConstraint } from '@/src/domain/quoting/types';

export type SubstitutionDecision = {
  allowed: boolean;
  reasonCodes: string[];
  checks: Array<{ code: string; passed: boolean; observed: string; required: string }>;
};

export function evaluateSubstitution(
  hardConstraints: HardConstraint[],
  candidateTags: string[],
): SubstitutionDecision {
  const checks = hardConstraints
    .filter((constraint) => constraint === 'vegan' || constraint === 'plastic-free')
    .map((constraint) => ({
      code: `SUBSTITUTE_${constraint.toUpperCase().replace('-', '_')}`,
      passed: candidateTags.includes(constraint),
      observed: candidateTags.join(',') || 'none',
      required: constraint,
    }));
  const failures = checks.filter((check) => !check.passed);
  return {
    allowed: failures.length === 0,
    reasonCodes:
      failures.length === 0
        ? ['SUBSTITUTION_CONSTRAINTS_PASSED']
        : failures.map((check) => `${check.code}_FAILED`),
    checks,
  };
}
