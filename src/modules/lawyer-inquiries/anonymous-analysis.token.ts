import { createHash, randomBytes } from 'node:crypto';

// 32 random bytes = 256 bits of entropy, base64url => exactly 43 chars.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Shape check only — never proves a session exists. Cheap pre-filter. */
export function isWellFormedSessionToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * SHA-256 hex digest. Only this digest is stored (anonymous_analysis_sessions
 * .session_token) and used in storage paths; the raw token exists solely in
 * the visitor's httpOnly cookie. A plain fast hash is appropriate because
 * the input is 256 bits of CSPRNG output, not a human-chosen secret.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
