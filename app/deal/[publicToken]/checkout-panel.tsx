'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type CheckoutPanelProps = {
  publicToken: string;
  quoteHash: string;
  amountPaise: number;
  accepted: boolean;
  disabled?: boolean;
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
      acceptedAt?: string | null;
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

type RazorpayCheckout = {
  open: () => void;
  close?: () => void;
};

type ScrollSnapshot = {
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyWidth: string;
  htmlOverflow: string;
  scrollY: number;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

function formatMoney(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

async function loadRazorpayCheckout() {
  if (window.Razorpay) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-boli-razorpay]');
    existing?.remove();
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.boliRazorpay = 'true';
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error('Checkout took too long to load. Please try again.'));
    }, 12_000);
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.Razorpay) resolve();
      else reject(new Error('Checkout loaded without becoming available. Please try again.'));
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error('Checkout could not load. Please check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
}

export function CheckoutPanel({
  publicToken,
  quoteHash,
  amountPaise,
  payment,
  accepted,
  disabled = false,
}: CheckoutPanelProps) {
  const router = useRouter();
  const checkoutKey = useRef<string | null>(null);
  const refundKey = useRef<string | null>(null);
  const razorpayCheckout = useRef<RazorpayCheckout | null>(null);
  const scrollSnapshot = useRef<ScrollSnapshot | null>(null);
  const paymentCallback = useRef<RazorpaySuccess | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [createdOrder, setCreatedOrder] = useState<CheckoutPanelProps['payment']['order']>(null);
  const order = payment.order ?? createdOrder;
  useEffect(() => {
    if (!notice || payment.stage !== 'payment_pending' || !paymentCallback.current) return;
    let attempts = 0;
    let timer = 0;
    let cancelled = false;
    const refresh = async () => {
      const callback = paymentCallback.current;
      if (!callback || cancelled) return;
      try {
        const response = await fetch('/api/razorpay/checkout/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(callback),
        });
        const body = await response.json() as {
          confirmed?: boolean;
          providerStatus?: string;
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(body.error?.message ?? 'Payment status could not be checked.');
        setError('');
        if (body.confirmed) {
          setNotice('Payment confirmed. Loading your order…');
          router.refresh();
          return;
        }
        setNotice(body.providerStatus === 'authorized'
          ? 'Payment authorized. Waiting for Razorpay to capture it…'
          : 'Payment received. Confirming it with Razorpay…');
      } catch {
        setNotice('Payment received. Retrying confirmation with Razorpay…');
      }
      router.refresh();
      attempts += 1;
      if (!cancelled && attempts < 20) timer = window.setTimeout(refresh, 3000);
    };
    timer = window.setTimeout(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [notice, payment.stage, router]);

  useEffect(() => () => {
    try { razorpayCheckout.current?.close?.(); } catch { /* Checkout may already be gone. */ }
    razorpayCheckout.current = null;
    const snapshot = scrollSnapshot.current;
    if (!snapshot) return;
    document.body.style.overflow = snapshot.bodyOverflow;
    document.body.style.position = snapshot.bodyPosition;
    document.body.style.top = snapshot.bodyTop;
    document.body.style.width = snapshot.bodyWidth;
    document.documentElement.style.overflow = snapshot.htmlOverflow;
    scrollSnapshot.current = null;
    window.scrollTo({ top: snapshot.scrollY });
  }, []);

  function rememberPageScroll() {
    if (scrollSnapshot.current) return;
    scrollSnapshot.current = {
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyWidth: document.body.style.width,
      htmlOverflow: document.documentElement.style.overflow,
      scrollY: window.scrollY,
    };
  }

  function releaseCheckoutScroll() {
    razorpayCheckout.current = null;
    const snapshot = scrollSnapshot.current;
    if (!snapshot) return;
    scrollSnapshot.current = null;
    const restore = () => {
      if (razorpayCheckout.current) return;
      document.body.style.overflow = snapshot.bodyOverflow;
      document.body.style.position = snapshot.bodyPosition;
      document.body.style.top = snapshot.bodyTop;
      document.body.style.width = snapshot.bodyWidth;
      document.documentElement.style.overflow = snapshot.htmlOverflow;
      window.scrollTo({ top: snapshot.scrollY });
    };
    restore();
    window.requestAnimationFrame(restore);
  }

  function closeCheckout() {
    const checkout = razorpayCheckout.current;
    try { checkout?.close?.(); } catch { /* Razorpay also closes itself after success. */ }
    releaseCheckoutScroll();
  }

  async function createOrder() {
    setBusy('create');
    setError('');
    checkoutKey.current ??= crypto.randomUUID();
    try {
      if (!accepted) {
        const approval = await fetch(`/api/public/deals/${publicToken}/accept`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedQuoteHash: quoteHash }),
        });
        const body = await approval.json() as { error?: { message?: string } };
        if (!approval.ok) throw new Error(body.error?.message ?? 'This offer could not be accepted. Refresh to review the latest price.');
      }
      const response = await fetch(`/api/public/deals/${publicToken}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedQuoteHash: quoteHash,
          idempotencyKey: checkoutKey.current,
        }),
      });
      const result = await response.json() as { state?: { order: CheckoutPanelProps['payment']['order'] }; error?: { message?: string } };
      if (!response.ok || !result.state?.order) throw new Error(result.error?.message ?? 'Checkout was not created.');
      setCreatedOrder(result.state.order);
      if (result.state.order.provider === 'razorpay') await openRazorpay(result.state.order);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Checkout was not created.');
      router.refresh();
    } finally {
      setBusy('');
    }
  }

  async function captureDemo() {
    if (!order) return;
    setBusy('capture');
    setError('');
    try {
      const response = await fetch(
        `/api/demo/payments/${encodeURIComponent(order.providerOrderId)}/capture`,
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

  async function openRazorpay(checkoutOrder = order) {
    const order = checkoutOrder;
    if (!order?.checkoutKeyId) { setError('Checkout is missing its provider key. Please refresh or check the local Razorpay configuration.'); return; }
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
        description: 'Your Boli order',
        order_id: order.providerOrderId,
        handler: async (result: RazorpaySuccess) => {
          closeCheckout();
          paymentCallback.current = result;
          setNotice('Payment received. Confirming it with Razorpay…');
          try {
            const response = await fetch('/api/razorpay/checkout/verify', {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result),
            });
            const body = await response.json() as {
              confirmed?: boolean;
              providerStatus?: string;
              error?: { message?: string };
            };
            if (!response.ok) throw new Error(body.error?.message ?? 'We could not verify the payment response. Refresh status before retrying.');
            setError('');
            setNotice(body.confirmed
              ? 'Payment confirmed. Loading your order…'
              : body.providerStatus === 'authorized'
                ? 'Payment authorized. Waiting for Razorpay to capture it…'
                : 'Payment received. Confirming it with Razorpay…');
            router.refresh();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Payment confirmation is being retried.');
          }
        },
        modal: {
          ondismiss: releaseCheckoutScroll,
        },
        theme: { color: '#183f32' },
      });
      rememberPageScroll();
      razorpayCheckout.current = checkout;
      checkout.open();
    } catch (caught) {
      closeCheckout();
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

  async function acceptReplacement() {
    setBusy('replacement');
    setError('');
    try {
      const response = await fetch(`/api/public/deals/${publicToken}/replacement/accept`, { method: 'POST' });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'Replacement was not accepted.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Replacement was not accepted.');
    } finally {
      setBusy('');
    }
  }

  if (payment.stage === 'refunded') {
    return (
      <section className="checkout-panel checkout-panel-refunded">
        <p className="micro-label">Recovery complete</p>
        <h3>Your refund has been processed.</h3>
        <p>
          {formatMoney(payment.refund?.amountPaise ?? amountPaise)} refunded. Reference:{' '}
          <code>{payment.refund?.providerRefundId}</code>.
        </p>
      </section>
    );
  }

  if (payment.incident) {
    return (
      <section className="checkout-panel checkout-panel-recovery">
        <p className="micro-label">An update to your order</p>
        <h3>{payment.incident.replacement.failedProduct} is no longer available.</h3>
        <p>{payment.incident.explanation}</p>
        <div className="recovery-comparison">
          <div><span>Blocked</span><strong>{payment.incident.replacement.blockedSubstitute}</strong><small>Does not meet your vegan requirement</small></div>
          <div><span>Offered</span><strong>{payment.incident.replacement.compliantReplacement}</strong><small>{payment.incident.replacement.buyerImpact}</small></div>
        </div>
        {payment.stage === 'replacement_offered' ? (
          <div className="recovery-actions">
            <button type="button" disabled={Boolean(busy)} onClick={acceptReplacement}>
              {busy === 'replacement' ? 'Reserving replacement…' : 'Accept valid replacement'}
            </button>
            <button className="secondary-action" type="button" disabled={Boolean(busy)} onClick={declineReplacement}>
              {busy === 'refund' ? 'Applying refund policy…' : payment.order?.provider === 'demo' ? 'Request simulated refund' : 'Request full refund'}
            </button>
          </div>
        ) : payment.stage === 'replacement_accepted' ? (
          <strong>Replacement accepted · no price or constraint changed.</strong>
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
        <p className="micro-label">Payment confirmed</p>
        <h3>{formatMoney(amountPaise)} paid. Thank you.</h3>
        <p>Your order is confirmed with The Good Batch.</p><details><summary>Payment reference</summary><code>{payment.providerPaymentId}</code></details>
      </section>
    );
  }

  if (!order) {
    return (
      <section className="checkout-panel">
        <div>
          <p>{accepted ? "Your offer is accepted. Continue to complete payment." : "By continuing, you accept the items, delivery requirements and total shown above."}</p><small>Test checkout · no live charges</small>
        </div>
        <button type="button" disabled={disabled || Boolean(busy)} onClick={createOrder}>
          {busy === 'create' ? 'Reserving inventory…' : `Continue to payment · ${formatMoney(amountPaise)}`}
        </button>
        {error ? <p className="deal-room-error" role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="checkout-panel checkout-panel-pending">
      <div>
        <p className="micro-label">{notice ? 'Payment received · checking status' : 'Razorpay order ready'}</p>
        <h3>{formatMoney(order.amountPaise)}</h3>
        <p>{notice ? 'Boli is confirming the captured payment with Razorpay.' : 'Open Razorpay Test Mode checkout to complete this order.'}</p>
      </div>
      {order.provider === 'demo' ? (
        <button type="button" disabled={Boolean(busy)} onClick={captureDemo}>
          {busy === 'capture' ? 'Verifying signed webhook…' : 'Simulate verified test payment →'}
        </button>
      ) : (
        <button type="button" disabled={Boolean(busy)} onClick={() => openRazorpay()}>
          {busy === 'razorpay' ? 'Opening Razorpay…' : 'Open Razorpay test checkout →'}
        </button>
      )}
      {notice ? <p className="checkout-notice" role="status">{notice}</p> : null}<button className="subtle-button" type="button" onClick={() => router.refresh()}>Refresh payment status</button>
      {error ? <p className="deal-room-error" role="alert">{error}</p> : null}
    </section>
  );
}
