import { BuyerExperience } from './buyer-experience';
import { OrderContent } from '../deal/[publicToken]/order-content';
import { DemoModeLabel } from '../demo-mode-label';
import { notFound } from 'next/navigation';
export default async function BuyPage({ searchParams }: { searchParams: Promise<{ product?: string; draft?: string; order?: string }> }) {
  const params = await searchParams;
  if (params.order && !/^[a-f0-9]{64}$/.test(params.order)) notFound();
  const product = typeof params.product === 'string' ? params.product.slice(0, 120) : '';
  return <main className="new-shell buyer-workspace">{params.order ? <OrderContent publicToken={params.order} embedded /> : <BuyerExperience key={product} initialProduct={product} restoreDraft={params.draft === '1'} />}<footer className="shopping-footer">{!params.order ? <DemoModeLabel /> : <span>AI proposes. Policy decides. Razorpay executes.</span>}</footer></main>;
}
