import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, verifyHmacSha256 } from './razorpay';

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
});
