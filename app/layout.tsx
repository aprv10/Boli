import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Boli — Turn intent into a deal',
  description: 'Boli turns complex bulk-buying requests into constrained, negotiable and payable orders.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
