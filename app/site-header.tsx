'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SlidingNavigation } from './components/sliding-navigation';

const navigation = [
  { key: 'buyer', label: 'Buy', href: '/' },
  { key: 'sell', label: 'Sell', href: '/sell' },
  { key: 'transactions', label: 'Transactions', href: '/transactions' },
] as const;

export function SiteHeader() {
  const pathname = usePathname() ?? '/';
  const merchant = pathname === '/sell' || pathname.startsWith('/merchant/');
  const active = merchant ? 'sell' : pathname.startsWith('/transactions') ? 'transactions' : 'buyer';
  return (
    <header className="site-header new-header">
      <Link className={`wordmark new-wordmark bilingual-wordmark ${pathname === '/' ? 'wordmark-living' : ''}`} href="/" aria-label="Boli home">
        <span className="wordmark-english" aria-hidden="true">boli<span className="wordmark-dot">.</span></span><span className="wordmark-hindi" lang="hi" aria-hidden="true">बोली<span className="wordmark-dot">.</span></span>
      </Link>
      <SlidingNavigation items={navigation} activeKey={active} label="Primary navigation" />
      <span className="site-context">{merchant ? 'The Good Batch' : 'Your next good deal'}</span>
    </header>
  );
}
