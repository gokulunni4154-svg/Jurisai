import { createHmac, timingSafeEqual } from 'crypto';

/**
 * verifyCashfreeWebhookSignature
 * -------------------------------
 * NEW THIS SESSION. Built against real Cashfree docs fetched this
 * session: https://www.cashfree.com/docs/api-reference/vrs/webhook-signature-verification
 *
 * Confirmed mechanism (not inferred): every Cashfree webhook carries an
 * `x-webhook-signature` header and an `x-webhook-timestamp` header. The
 * expected signature is HMAC-SHA256 of `timestamp + rawBody` (string
 * concatenation, no delimiter), keyed with the webhook secret, base64
 * encoded. The docs explicitly warn to use the raw, unparsed request
 * body — not a re-serialized JSON object — since any difference in key
 * order or whitespace changes the hash. This is why the route handler
 * (billing/webhooks/cashfree/route.ts) reads `request.text()` and passes
 * that raw string straight into this function, never `request.json()`
 * first.
 *
 * Uses `timingSafeEqual`, not `===`, to compare signatures — a
 * straightforward `===` string comparison leaks timing information an
 * attacker could exploit to guess the correct signature byte-by-byte.
 * This wasn't specified by Cashfree's own docs (their own example code
 * snippets use plain string equality), but is a standard hardening this
 * project should still apply. Flagged as an addition beyond the
 * documented example, not a divergence from it.
 */
export function verifyCashfreeWebhookSignature(
  timestamp: string,
  rawBody: string,
  receivedSignature: string,
  secret: string,
): boolean {
  const expectedSignature = createHmac('sha256', secret)
    .update(timestamp + rawBody)
    .digest('base64');

  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(receivedSignature);

  // timingSafeEqual throws if buffer lengths differ, rather than
  // returning false -- guard explicitly so a malformed/short header
  // value fails closed instead of throwing an uncaught error inside the
  // route handler.
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}