import { BuyerExperience } from './buyer-experience';
export default async function BuyPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const params = await searchParams;
  const product = typeof params.product === 'string' ? params.product.slice(0, 120) : '';
  return <main className="new-shell"><BuyerExperience initialProduct={product} /></main>;
}
