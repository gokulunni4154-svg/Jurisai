import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/core/auth/session';
import { resolveCallerFirmId } from '@/core/auth/resolve-caller-firm-id';

/**
 * GET /audit-log/firm (legacy path)
 *
 * Terminal Route Namespace Migration — this page's real content moved to
 * (dashboard)/firm/[firmId]/audit-log/page.tsx. This file exists only so
 * old bookmarks/links to bare `/audit-log/firm` keep working, and so the
 * several existing internal "View firm audit log" buttons that don't have
 * a firmId in local scope (Lawyer Terminal dashboard/cases/hearings quick
 * actions) can keep pointing at this same path unchanged.
 *
 * See src/app/observability/page.tsx for the full rationale — same
 * pattern, same firm-resolution helper, same fallback.
 */
export default async function LegacyFirmAuditLogRedirectPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/sign-in');
  }

  const firmId = await resolveCallerFirmId(user);

  if (!firmId) {
    redirect('/general-user/dashboard');
  }

  redirect(`/firm/${firmId}/audit-log`);
}
