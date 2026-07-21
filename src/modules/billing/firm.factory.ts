import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';

import { FirmRepository } from './firm.repository';
import { ProfileRepository } from './profile.repository';
import { FirmService } from './firm.service';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';

/**
 * Closes Item #67.
 *
 * UNLIKE billing.factory.ts's createCheckoutSession() wiring — which reads
 * FirmRepository via the RLS-respecting createClient() — this factory
 * constructs FirmRepository AND ProfileRepository against
 * createAdminClient() (RLS-bypassing) for both of them. This isn't a
 * style choice, it mirrors the hard requirement billing.factory.ts already
 * established for SubscriptionRepository: 20260726000002_create_firms_table.sql's
 * own comment states firm creation is service-layer only ("No insert
 * ... policy for authenticated"), and there is no client-writable policy
 * for profiles.firm_id either (profiles' own RLS has never been pasted in
 * this session to confirm that directly, but the firms migration's stated
 * reasoning — "membership changes are service-layer operations" — applies
 * equally to the profile side of that same operation).
 *
 * AMENDED (Firm-creation audit entry, prior session) — FirmService also
 * needs an AuditLogRepository (see firm.service.ts's own header on why:
 * createFirm() writes a 'firm.create' audit entry as its final step).
 * The same single adminClient instance already in scope is reused for
 * AuditLogRepository too, no second client needed — matches
 * audit-log.factory.ts's own established precedent that AuditLogRepository
 * is always constructed against the admin client.
 *
 * AMENDED, THIS SESSION — Phase 4, Enterprise & Collaboration.
 * FirmMemberRepository added as a 4th dependency, closing the same
 * "which client" question the same way: firm_members has no
 * client-writable RLS policy either (see that table's own migration
 * header — "No insert/update/delete policy for authenticated: membership
 * changes... are service-layer operations only"), so it's constructed
 * against the same adminClient already in scope here, same reasoning as
 * every other repository in this factory.
 */
export function createFirmService(currentUser: AuthUser | null): FirmService {
  const adminClient = createAdminClient();

  const firmRepository = new FirmRepository(adminClient);
  const profileRepository = new ProfileRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);
  const firmMemberRepository = new FirmMemberRepository(adminClient);

  return new FirmService(
    currentUser,
    firmRepository,
    profileRepository,
    auditLogRepository,
    firmMemberRepository,
  );
}