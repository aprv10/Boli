import Link from 'next/link';
import { BuyerExperience } from './request/buyer-experience';
import { HomeStory } from './home-story';
import { OrderContent } from './deal/[publicToken]/order-content';
import { DemoModeLabel } from './demo-mode-label';
import { notFound } from 'next/navigation';

export default async function Home({ searchParams }: { searchParams: Promise<{ order?: string; draft?: string }> }) {
  const params = await searchParams;
  if (params.order && !/^[a-f0-9]{64}$/.test(params.order)) notFound();
  return <main className="new-shell shopping-home">
    {params.order ? <OrderContent publicToken={params.order} embedded newRequestPath="/" /> : <BuyerExperience home restoreDraft={params.draft === '1'}><HomeStory /></BuyerExperience>}
    <footer className="shopping-footer">{!params.order ? <DemoModeLabel /> : <span>AI proposes. Policy decides. Razorpay executes.</span>}<Link href="/sell">Make your store AI-ready →</Link></footer>
  </main>;
}
