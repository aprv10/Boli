'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type CheckoutPanelProps = {
  publicToken: string;
  quoteHash: string;
  amountPaise: number;
  payment: {
    stage: string;
    order: null | {
      providerOrderId: string;
      provider: 'razorpay' | 'demo';
      checkoutKeyId: string | null;
      amountPaise: number;
      currency: string;
      status: string;
    };
    providerPaymentId: string | null;
    refund: null | {
      providerRefundId: string | null;
      amountPaise: number;
      status: string;
    };
    incident: null | {
      status: string;
      explanation: string;
      replacement: {
        failedProduct: string;
        blockedSubstitute: string;
        compliantReplacement: string;
        buyerImpact: string;
      };
    };
  };
};

type RazorpaySuccess = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function formatMoney(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

async function loadRazorpayCheckout() {
  if (window.Razorpay) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-boli-razorpay]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Checkout could not load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.boliRazorpay = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Checkout could not load.'));
    document.head.appendChild(script);
  });
}

export function CheckoutPanel({
  publicToken,
  quoteHash,
  amountPaise,
  payment,
}: CheckoutPanelProps) {
  const router = useRouter();
  const checkoutKey = useRef<string | null>(null);
  const refundKey = useRef<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function createOrder() {
    setBusy('create');
    setError('');
    checkoutKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/public/deals/${publicToken}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedQuoteHash: quoteHash,
          idempotencyKey: checkoutKey.current,
        }),
      });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'Checkout was not created.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Checkout was not created.');
    } finally {
      setBusy('');
    }
  }

  async function captureDemo() {
    if (!payment.order) return;
    setBusy('capture');
    setError('');
    try {
      const response = await fetch(
        `/api/demo/payments/${encodeURIComponent(payment.order.providerOrderId)}/capture`,
        { method: 'POST' },
      );
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'Demo payment was not captured.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Demo payment was not captured.');
    } finally {
      setBusy('');
    }
  }

  async function openRazorpay() {
    const order = payment.order;
    if (!order?.checkoutKeyId) return;
    setBusy('razorpay');
    setError('');
    try {
      await loadRazorpayCheckout();
      if (!window.Razorpay) throw new Error('Razorpay Checkout is unavailable.');
      const checkout = new window.Razorpay({
        key: order.checkoutKeyId,
        amount: order.amountPaise,
        currency: order.currency,
        name: 'Boli · The Good Batch',
        description: 'Exact accepted corporate gifting quote',
        order_id: order.providerOrderId,
        handler: async (result: RazorpaySuccess) => {
          const response = await fetch('/api/razorpay/checkout/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(result),
          });
          if (!response.ok) {
            const body = (await response.json()) as { error?: { message?: string } };
            setError(body.error?.message ?? 'Checkout signature could not be verified.');
            return;
          }
          setNotice('Checkout signature verified. Waiting for the captured-payment webhook.');
          router.refresh();
        },
        theme: { color: '#bf4f2c' },
      });
      checkout.open();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Razorpay Checkout is unavailable.');
    } finally {
      setBusy('');
    }
  }

  async function declineReplacement() {
    setBusy('refund');
    setError('');
    refundKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/public/deals/${publicToken}/replacement/decline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: refundKey.current }),
      });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'Refund was not requested.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Refund was not requested.');
    } finally {
      setBusy('');
    }
  }

  if (payment.stage === 'refunded') {
    return (
      <section className="checkout-panel checkout-panel-refunded">
        <p className="micro-label">Recovery complete</p>
        <h3>Exactly one full refund processed.</h3>
        <p>
          {formatMoney(payment.refund?.amountPaise ?? amountPaise)} returned under provider reference{' '}
          <code>{payment.refund?.providerRefundId}</code>.
        </p>
      </section>
    );
  }

  if (payment.incident) {
    return (
      <section className="checkout-panel checkout-panel-recovery">
        <p className="micro-label">Constraint-safe recovery</p>
        <h3>{payment.incident.replacement.failedProduct} was lost after payment.</h3>
        <p>{payment.incident.explanation}</p>
        <div className="recovery-comparison">
          <div><span>Blocked</span><strong>{payment.incident.replacement.blockedSubstitute}</strong><small>Violates vegan lock</small></div>
          <div><span>Offered</span><strong>{payment.incident.replacement.compliantReplacement}</strong><small>{payment.incident.replacement.buyerImpact}</small></div>
        </div>
        {payment.stage === 'replacement_offered' ? (
          <button type="button" disabled={Boolean(busy)} onClick={declineReplacement}>
            {busy === 'refund' ? 'Applying refund policy…' : 'Decline replacement & refund →'}
          </button>
        ) : (
          <strong>Refund reconciliation is in progress.</strong>
        )}
        {error ? <p className="deal-room-error" role="alert">{error}</p> : null}
      </section>
    );
  }

  if (payment.stage === 'paid') {
    return (
      <section className="checkout-panel checkout-panel-paid">
        <p className="micro-label">Verified payment</p>
        <h3>{formatMoney(amountPaise)} captured by signed webhook.</h3>
        <p>Payment <code>{payment.providerPaymentId}</code> matches the exact order amount and currency.</p>
      </section>
    );
  }

  if (!payment.order) {
    return (
      <section className="checkout-panel">
        <div>
          <p className="micro-label">Separate money gate</p>
          <h3>Create a Razorpay test order.</h3>
          <p>Boli will recheck the accepted hash, policy, amount, and live inventory first.</p>
        </div>
        <button type="button" disabled={Boolean(busy)} onClick={createOrder}>
          {busy === 'create' ? 'Reserving inventory…' : `Create checkout · ${formatMoney(amountPaise)} →`}
        </button>
        {error ? <p className="deal-room-error" role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="checkout-panel checkout-panel-pending">
      <div>
        <p className="micro-label">Order created · payment pending</p>
        <h3>{formatMoney(payment.order.amountPaise)} · {payment.order.providerOrderId}</h3>
        <p>The browser cannot mark this deal paid. Only a verified captured-payment webhook can.</p>
      </div>
      {payment.order.provider === 'demo' ? (
        <button type="button" disabled={Boolean(busy)} onClick={captureDemo}>
          {busy === 'capture' ? 'Verifying signed webhook…' : 'Simulate verified test payment →'}
        </button>
      ) : (
        <button type="button" disabled={Boolean(busy)} onClick={openRazorpay}>
          {busy === 'razorpay' ? 'Opening Razorpay…' : 'Open Razorpay test checkout →'}
        </button>
      )}
      {notice ? <p className="checkout-notice">{notice}</p> : null}
      {error ? <p className="deal-room-error" role="alert">{error}</p> : null}
    </section>
  );
}
