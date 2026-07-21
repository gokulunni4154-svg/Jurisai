// src/modules/user-management/firm-member.factory.ts

import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';

import { FirmMemberRepository } from './firm-member.repository';
import { FirmMemberService } from './firm-member.service';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

/**
 * NEW, Phase 4 — Enterprise & Collaboration.
 *
 * Constructed against createAdminClient(), same reasoning firm.factory.ts
 * already establishes for FirmRepository/ProfileRepository/
 * FirmMemberRepository: firm_members has no client-writable RLS policy
 * (see that table's own migration header — "No insert/update/delete
 * policy for authenticated: membership changes... are service-layer
 * operations only"), so every write here must go through the admin
 * client regardless of which user is acting. FirmMemberService's own
 * requireFirmRole()-based checks are what stand in for RLS on this
 * table's write path — same division of responsibility
 * professional-verification.factory.ts and audit-log.factory.ts both
 * already establish for their own admin-client-backed repositories.
 */
export function createFirmMemberService(currentUser: AuthUser | null): FirmMemberService {
  const adminClient = createAdminClient();

  const firmMemberRepository = new FirmMemberRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  return new FirmMemberService(currentUser, firmMemberRepository, auditLogRepository);
}