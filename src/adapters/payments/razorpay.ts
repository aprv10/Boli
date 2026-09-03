const RAZORPAY_API = 'https://api.razorpay.com/v1';

export type PaymentProvider = 'razorpay' | 'demo';

export class PaymentProviderError extends Error {
  constructor(
    readonly code: 'PAYMENT_CONFIGURATION_INVALID' | 'PROVIDER_REJECTED' | 'PROVIDER_UNAVAILABLE',
    message: string,
    readonly reconciliationRequired = false,
  ) {
    super(message);
  }
}

export type CreatedProviderOrder = {
  provider: PaymentProvider;
  providerOrderId: string;
  checkoutKeyId: string | null;
  amountPaise: number;
  currency: 'INR';
};

export type CreatedProviderRefund = {
  provider: PaymentProvider;
  providerRefundId: string;
  status: 'processed' | 'pending';
};

export type ProviderPaymentSnapshot = {
  providerPaymentId: string;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  status: string;
};

function paymentMode(): PaymentProvider {
  return process.env.BOLI_PAYMENT_MODE === 'razorpay' ? 'razorpay' : 'demo';
}

function razorpayCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() ?? '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? '';
  if (!keyId || !keySecret) {
    throw new PaymentProviderError(
      'PAYMENT_CONFIGURATION_INVALID',
      'Razorpay test credentials are not configured.',
    );
  }
  if (!keyId.startsWith('rzp_test_')) {
    throw new PaymentProviderError(
      'PAYMENT_CONFIGURATION_INVALID',
      'Boli accepts only Razorpay test-mode keys in this build.',
    );
  }
  return { keyId, keySecret };
}

function basicAuthorization(keyId: string, keySecret: string) {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

async function providerJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function configuredPaymentProvider(): PaymentProvider {
  return paymentMode();
}

export function checkoutSecret() {
  return razorpayCredentials().keySecret;
}

export function webhookSecret({ allowDemo = false }: { allowDemo?: boolean } = {}) {
  const configured = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (configured) return configured;
  if (allowDemo && paymentMode() === 'demo' && process.env.NODE_ENV !== 'production') {
    return 'boli-local-signed-webhook-v1';
  }
  throw new PaymentProviderError(
    'PAYMENT_CONFIGURATION_INVALID',
    'Razorpay webhook verification is not configured.',
  );
}

export async function createProviderOrder(input: {
  actionId: string;
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
}): Promise<CreatedProviderOrder> {
  if (paymentMode() === 'demo') {
    return {
      provider: 'demo',
      providerOrderId: `order_demo_${input.actionId.replaceAll('-', '').slice(0, 20)}`,
      checkoutKeyId: null,
      amountPaise: input.amountPaise,
      currency: 'INR',
    };
  }

  const { keyId, keySecret } = razorpayCredentials();
  let response: Response;
  try {
    response = await fetch(`${RAZORPAY_API}/orders`, {
      method: 'POST',
      headers: {
        authorization: basicAuthorization(keyId, keySecret),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt.slice(0, 40),
        notes: input.notes,
      }),
    });
  } catch {
    throw new PaymentProviderError(
      'PROVIDER_UNAVAILABLE',
      'Razorpay did not confirm whether the order was created.',
      true,
    );
  }
  const payload = await providerJson(response);
  if (!response.ok || typeof payload.id !== 'string') {
    throw new PaymentProviderError(
      'PROVIDER_REJECTED',
      'Razorpay rejected the test order request.',
    );
  }
  return {
    provider: 'razorpay',
    providerOrderId: payload.id,
    checkoutKeyId: keyId,
    amountPaise: input.amountPaise,
    currency: 'INR',
  };
}

export async function createProviderRefund(input: {
  actionId: string;
  providerPaymentId: string;
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
  provider: PaymentProvider;
}): Promise<CreatedProviderRefund> {
  if (input.provider === 'demo') {
    return {
      provider: 'demo',
      providerRefundId: `rfnd_demo_${input.actionId.replaceAll('-', '').slice(0, 20)}`,
      status: 'processed',
    };
  }

  const { keyId, keySecret } = razorpayCredentials();
  let response: Response;
  try {
    response = await fetch(
      `${RAZORPAY_API}/payments/${encodeURIComponent(input.providerPaymentId)}/refund`,
      {
        method: 'POST',
        headers: {
          authorization: basicAuthorization(keyId, keySecret),
          'content-type': 'application/json',
          'x-refund-idempotency': input.actionId,
        },
        body: JSON.stringify({
          amount: input.amountPaise,
          speed: 'normal',
          receipt: input.receipt,
          notes: input.notes,
        }),
      },
    );
  } catch {
    throw new PaymentProviderError(
      'PROVIDER_UNAVAILABLE',
      'Razorpay did not confirm whether the refund was created.',
      true,
    );
  }
  const payload = await providerJson(response);
  if (!response.ok || typeof payload.id !== 'string') {
    throw new PaymentProviderError(
      'PROVIDER_REJECTED',
      'Razorpay rejected the test refund request.',
    );
  }
  return {
    provider: 'razorpay',
    providerRefundId: payload.id,
    status: payload.status === 'processed' ? 'processed' : 'pending',
  };
}

export async function fetchRazorpayPayment(
  providerPaymentId: string,
): Promise<ProviderPaymentSnapshot> {
  const { keyId, keySecret } = razorpayCredentials();
  let response: Response;
  try {
    response = await fetch(
      `${RAZORPAY_API}/payments/${encodeURIComponent(providerPaymentId)}`,
      {
        headers: { authorization: basicAuthorization(keyId, keySecret) },
      },
    );
  } catch {
    throw new PaymentProviderError(
      'PROVIDER_UNAVAILABLE',
      'Razorpay payment status is temporarily unavailable.',
      true,
    );
  }
  const payload = await providerJson(response);
  if (
    !response.ok ||
    typeof payload.id !== 'string' ||
    payload.id !== providerPaymentId ||
    typeof payload.order_id !== 'string' ||
    typeof payload.amount !== 'number' ||
    !Number.isInteger(payload.amount) ||
    payload.amount <= 0 ||
    typeof payload.currency !== 'string' ||
    typeof payload.status !== 'string'
  ) {
    throw new PaymentProviderError(
      'PROVIDER_REJECTED',
      'Razorpay did not return a valid payment status.',
      response.ok,
    );
  }
  return {
    providerPaymentId: payload.id,
    providerOrderId: payload.order_id,
    amountPaise: payload.amount,
    currency: payload.currency,
    status: payload.status,
  };
}

export async function hmacSha256Hex(payload: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(signature)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyHmacSha256(
  payload: string,
  signature: string,
  secret: string,
) {
  const expected = await hmacSha256Hex(payload, secret);
  if (signature.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return difference === 0;
}

export async function sha256Text(payload: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
