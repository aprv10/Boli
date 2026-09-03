import Link from 'next/link';
import { BuyerExperience } from './request/buyer-experience';
import { HomeStory } from './home-story';

export default function Home() {
  return <main className="new-shell shopping-home">
    <BuyerExperience home><HomeStory /></BuyerExperience>
    <footer className="shopping-footer"><span>Shopping from The Good Batch’s demo catalog · Test payments only</span><Link href="/sell">Sell with Boli →</Link></footer>
  </main>;
}
