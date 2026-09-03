import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRazorpayPayment, hmacSha256Hex, verifyHmacSha256 } from './razorpay';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Razorpay signature helpers', () => {
  it('verifies the raw payload and rejects any mutation', async () => {
    const secret = 'test-webhook-secret';
    const payload = '{"event":"payment.captured","amount":12345}';
    const signature = await hmacSha256Hex(payload, secret);

    await expect(verifyHmacSha256(payload, signature, secret)).resolves.toBe(true);
    await expect(
      verifyHmacSha256(payload.replace('12345', '12346'), signature, secret),
    ).resolves.toBe(false);
  });

  it('uses the checkout order-id and payment-id signature contract', async () => {
    const payload = 'order_test_123|pay_test_456';
    const signature = await hmacSha256Hex(payload, 'key-secret');

    await expect(verifyHmacSha256(payload, signature, 'key-secret')).resolves.toBe(true);
  });

  it('fetches captured payment facts from Razorpay using test credentials', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_example');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'test-secret');
    const providerFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'pay_test_456',
      order_id: 'order_test_123',
      amount: 62_179_20,
      currency: 'INR',
      status: 'captured',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', providerFetch);

    await expect(fetchRazorpayPayment('pay_test_456')).resolves.toEqual({
      providerPaymentId: 'pay_test_456',
      providerOrderId: 'order_test_123',
      amountPaise: 62_179_20,
      currency: 'INR',
      status: 'captured',
    });
    expect(providerFetch).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/payments/pay_test_456',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: expect.stringMatching(/^Basic /) }),
      }),
    );
  });

  it('rejects malformed provider payment facts', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_example');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'test-secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'pay_different',
      order_id: 'order_test_123',
      amount: '6217920',
      currency: 'INR',
      status: 'captured',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(fetchRazorpayPayment('pay_test_456')).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED',
      reconciliationRequired: true,
    });
  });
});
