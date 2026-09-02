import Link from 'next/link';

type SiteHeaderProps = {
  active?: 'home' | 'buyer' | 'agent' | 'merchant';
  context?: string;
};

const navigation = [
  { key: 'home', label: 'Home', href: '/' },
  { key: 'buyer', label: 'Start buying', href: '/request' },
  { key: 'agent', label: 'AI buyer demo', href: '/agent' },
  { key: 'merchant', label: 'Merchant workspace', href: '/merchant/deals' },
] as const;

export function SiteHeader({ active = 'home', context }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <Link className="wordmark" href="/" aria-label="Boli home">
        <span className="wordmark-stamp" aria-hidden="true">B</span>
        <span>Boli</span>
      </Link>
      <nav className="site-navigation" aria-label="Primary navigation">
        {navigation.map((item) => (
          <Link
            className={item.key === active ? 'site-nav-link site-nav-link-active' : 'site-nav-link'}
            href={item.href}
            aria-current={item.key === active ? 'page' : undefined}
            key={item.key}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <span className="site-context">{context ?? 'Bulk buying, made clear'}</span>
    </header>
  );
}
