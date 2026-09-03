import { configuredPaymentProvider } from '@/src/adapters/payments/razorpay';

export function DemoModeLabel({ provider = configuredPaymentProvider() }: { provider?: 'demo' | 'razorpay' }) {
  return <span>Demo merchant · {provider === 'razorpay' ? 'Razorpay Test Mode' : 'Simulated payments'}</span>;
}
