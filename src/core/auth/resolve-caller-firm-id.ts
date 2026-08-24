import { createClient } from '@/core/supabase/server';
import { FirmRepository } from '@/modules/billing/firm.repository';
import { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';
import type { AuthUser } from '@/core/auth/types';

/**
 * Resolves the firm the current user is an owner or admin member of, if
 * any.
 *
 * EXTRACTED FROM: resolveDashboardRedirect() in
 * src/app/api/auth/sign-in/route.ts, which has resolved firmId this exact
 * way (owned firm checked first, then admin membership) since before this
 * migration. This is a pure extraction for reuse by the two Terminal Route
 * Namespace Migration legacy-redirect pages (src/app/observability/page.tsx,
 * src/app/audit-log/firm/page.tsx) — NOT a new resolution algorithm, and
 * resolveDashboardRedirect() itself is intentionally left untouched rather
 * than refactored to call this, to keep this migration's diff to
 * additive/rename changes in the sign-in route (see that route's own
 * updated comment).
 *
 * Failure is swallowed to `null`, matching resolveDashboardRedirect()'s own
 * posture: a lookup failure here should degrade the destination, not throw
 * through a redirect page.
 */
export async function resolveCallerFirmId(user: AuthUser): Promise<string | null> {
  try {
    const supabase = await createClient();
    const firmRepository = new FirmRepository(supabase);
    const firm = await firmRepository.findByOwnerId(user.id);
    if (firm) {
      return firm.id;
    }

    const firmMemberRepository = new FirmMemberRepository(supabase);
    const memberships = await firmMemberRepository.findByProfileId(user.id);
    const adminMembership = memberships.find((m) => m.role === 'admin');
    return adminMembership ? adminMembership.firm_id : null;
  } catch {
    return null;
  }
}
