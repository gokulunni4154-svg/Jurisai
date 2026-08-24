import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/core/auth/session';
import { resolveCallerFirmId } from '@/core/auth/resolve-caller-firm-id';

/**
 * GET /observability (legacy path)
 *
 * Terminal Route Namespace Migration — this page's real content moved to
 * (dashboard)/firm/[firmId]/observability/page.tsx. This file exists only
 * so old bookmarks/links to bare `/observability` keep working.
 *
 * Middleware's resolveRouteProtection() already redirects unauthenticated
 * requests to /sign-in before this component ever runs, so `user` here is
 * expected to be non-null in the normal case; the `!user` branch is
 * defense-in-depth, not the primary auth gate.
 *
 * If firmId resolution fails (no owned/admin firm found), falls back to
 * /general-user/dashboard rather than throwing — a firmId-less caller
 * hitting this legacy URL has no firm-scoped destination to send them to,
 * and this route has never done role-gating (that remains the Service
 * layer's job, unchanged).
 */
export default async function LegacyObservabilityRedirectPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/sign-in');
  }

  const firmId = await resolveCallerFirmId(user);

  if (!firmId) {
    redirect('/general-user/dashboard');
  }

  redirect(`/firm/${firmId}/observability`);
}
