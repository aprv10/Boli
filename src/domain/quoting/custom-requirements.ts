import { z } from 'zod';

export const customRequirementSchema = z.object({
  text: z.string().trim().min(3).max(200),
  priority: z.enum(['required', 'preferred']),
});
export type CustomRequirement = z.infer<typeof customRequirementSchema>;
export const customRequirementsSchema = z.array(customRequirementSchema).max(12);
export const requiresMerchantReview = (requirements: CustomRequirement[]) => requirements.some(item => item.priority === 'required');
