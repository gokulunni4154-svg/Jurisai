import { isIP } from 'node:net';

/**
 * Best-effort client IP for abuse limiting only (never for authorization).
 *
 * TRUST MODEL: JurisAI deploys on Vercel, which overwrites
 * x-vercel-forwarded-for / x-real-ip / x-forwarded-for at its edge, so
 * those values are not client-controlled THERE. On any other host that does
 * not strip client-supplied forwarding headers, these are spoofable and the
 * per-IP limit degrades to the shared global limit as the real backstop.
 * Values that are not syntactically valid IPs are ignored.
 */
export function getClientIp(headers: Headers): string | null {
  const candidates = [
    headers.get('x-vercel-forwarded-for'),
    headers.get('x-real-ip'),
    headers.get('x-forwarded-for')?.split(',')[0],
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && isIP(value) !== 0) {
      return value;
    }
  }

  return null;
}
