import { BuyerExperience } from './buyer-experience';
export default async function BuyPage({ searchParams }: { searchParams: Promise<{ product?: string; draft?: string }> }) {
  const params = await searchParams;
  const product = typeof params.product === 'string' ? params.product.slice(0, 120) : '';
  return <main className="new-shell"><BuyerExperience key={`${product}:${params.draft ?? ''}`} initialProduct={product} restoreDraft={params.draft === '1'} /></main>;
}
