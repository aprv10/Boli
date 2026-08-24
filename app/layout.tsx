import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? 'http://localhost:3000'),
  title: 'Boli — Turn intent into a deal',
  description:
    'Boli turns complex bulk-buying requests into constrained, negotiable and payable orders.',
  openGraph: {
    title: 'Boli — Turn intent into a deal',
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
      <body>{children}</body>
    </html>
  );
}
