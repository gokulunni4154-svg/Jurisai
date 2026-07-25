// src/modules/user-management/client-invitation.factory.ts

import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';

import { ClientInvitationRepository } from './client-invitation.repository';
import { ClientRepository } from './client.repository';
import { FirmMemberRepository } from './firm-member.repository';
import { ClientInvitationService } from './client-invitation.service';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

/**
 * Client Management. Direct mirror of firm-invitation.factory.ts's
 * real, confirmed shape — single createAdminClient() instance, every
 * repository constructed against it, no per-repository client
 * variation, same "membership/invitation changes are service-layer
 * operations, not RLS-writable" reasoning (client_invitations has no
 * insert/update/delete policy for `authenticated`, confirmed in the
 * pasted migration).
 *
 * NO AuthUserRepository here, unlike firm-invitation.factory.ts —
 * see client-invitation.service.ts's own class doc comment for why
 * that dependency has no client analog.
 */
export function createClientInvitationService(currentUser: AuthUser | null): ClientInvitationService {
  const adminClient = createAdminClient();

  const clientInvitationRepository = new ClientInvitationRepository(adminClient);
  const clientRepository = new ClientRepository(adminClient);
  const firmMemberRepository = new FirmMemberRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  return new ClientInvitationService(
    currentUser,
    clientInvitationRepository,
    clientRepository,
    firmMemberRepository,
    auditLogRepository,
  );
}