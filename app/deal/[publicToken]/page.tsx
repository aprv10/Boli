import type { Metadata } from 'next';
import { OrderContent } from './order-content';

export const metadata: Metadata = { title: 'Your order — Boli', description: 'Review your items, request a better price and pay securely.', openGraph: { images: [] }, twitter: { images: [] } };

export default async function DealRoomPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  return <OrderContent publicToken={publicToken} />;
}
