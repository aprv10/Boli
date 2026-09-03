'use client';

import { usePathname } from 'next/navigation';
import { SlidingNavigation } from '../components/sliding-navigation';

const items = [
  { key: 'overview', label: 'Overview', href: '/sell' },
  { key: 'orders', label: 'Orders', href: '/merchant/deals' },
  { key: 'products', label: 'Products', href: '/merchant/products' },
  { key: 'rules', label: 'Rules', href: '/merchant/policies' },
] as const;

export function MerchantNav() {
  const pathname = usePathname() ?? '/';
  if (pathname !== '/sell' && !pathname.startsWith('/merchant/')) return null;
  const active = pathname.startsWith('/merchant/deals') ? 'orders' : pathname.startsWith('/merchant/products') ? 'products' : pathname.startsWith('/merchant/policies') ? 'rules' : 'overview';
  return <SlidingNavigation items={items} activeKey={active} variant="underline" label="Merchant workspace" />;
}
