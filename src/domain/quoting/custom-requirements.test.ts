import { describe, expect, it } from 'vitest';
import { customRequirementsSchema, requiresMerchantReview } from './custom-requirements';
describe('custom requirements', () => {
  it('requires a real store review for mandatory, unverified conditions', () => {
    expect(requiresMerchantReview([{ text: 'Certified nut-free', priority: 'required' }])).toBe(true);
    expect(requiresMerchantReview([{ text: 'Blue packaging', priority: 'preferred' }])).toBe(false);
    expect(requiresMerchantReview([])).toBe(false);
  });
  it('does not accept a buyer-provided verified flag as authority', () => {
    const parsed = customRequirementsSchema.parse([{ text: 'Blue packaging', priority: 'required', verified: true }]);
    expect(parsed[0]).not.toHaveProperty('verified');
    expect(requiresMerchantReview(parsed)).toBe(true);
  });
  it('rejects missing priority and excessive requirement lists', () => {
    expect(customRequirementsSchema.safeParse([{ text: 'Blue packaging' }]).success).toBe(false);
    expect(customRequirementsSchema.safeParse(Array.from({ length: 13 }, () => ({ text: 'Blue packaging', priority: 'required' }))).success).toBe(false);
  });
});
