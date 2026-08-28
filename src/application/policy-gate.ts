import { and, desc, eq } from 'drizzle-orm';
import { merchantPolicyVersions } from '@/db/schema';
import { getDatabase } from '@/src/adapters/db/database';
import type { MerchantPolicy } from '@/src/domain/policies/commerce-policy';

export async function loadActiveMerchantPolicy(
  binding: D1Database,
  merchantId: string,
): Promise<MerchantPolicy> {
  const [row] = await getDatabase(binding)
    .select()
    .from(merchantPolicyVersions)
    .where(
      and(
        eq(merchantPolicyVersions.merchantId, merchantId),
        eq(merchantPolicyVersions.status, 'active'),
      ),
    )
    .orderBy(desc(merchantPolicyVersions.version))
    .limit(1);

  if (!row) {
    throw new Error('The merchant has no active commerce policy.');
  }

  return {
    version: row.version,
    minimumMarginBps: row.minimumMarginBps,
    maximumAutomaticConcessionBps: row.maximumAutomaticConcessionBps,
  };
}
