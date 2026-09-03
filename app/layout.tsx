import type { Metadata } from 'next';
import '@fontsource-variable/manrope';
import '@fontsource/instrument-serif';
import '@fontsource/instrument-serif/400-italic.css';
import './globals.css';
import './visual-system.css';
import './product-experience.css';
import './landing-and-motion.css';
import './usability.css';
import { SiteHeader } from './site-header';
import { MerchantNav } from './merchant/merchant-nav';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? 'http://localhost:3000'),
  title: 'Boli — Find a deal that fits',
  description:
    'Say what you need. Explore products, ask for a better offer, and buy with Boli.',
  openGraph: {
    title: 'Boli — Find a deal that fits',
    description:
      'Constrained, negotiable and payable bulk orders for human and AI buyers.',
    images: [
      {
        url: '/og.png',
        width: 1536,
        height: 1024,
        alt: 'Boli — Turn intent into a deal.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Boli — Turn intent into a deal',
    description:
      'Constrained, negotiable and payable bulk orders for human and AI buyers.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><SiteHeader /><MerchantNav />{children}</body>
    </html>
  );
}
