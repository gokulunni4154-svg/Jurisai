// src/modules/user-management/client.factory.ts

import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';

import { ClientRepository } from './client.repository';
import { FirmMemberRepository } from './firm-member.repository';
import { ClientService } from './client.service';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

/**
 * Client Management. Direct mirror of firm-invitation.factory.ts /
 * client-invitation.factory.ts's real, confirmed shape — single
 * createAdminClient() instance, every repository constructed against
 * it, all authorization enforced by ClientService's own
 * requireFirmRole() calls rather than RLS (writes go through the admin
 * client, same established pattern — see client.service.ts's own class
 * doc comment for the real RLS-vs-service-layer discussion this
 * required).
 */
export function createClientService(currentUser: AuthUser | null): ClientService {
  const adminClient = createAdminClient();

  const clientRepository = new ClientRepository(adminClient);
  const firmMemberRepository = new FirmMemberRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  return new ClientService(currentUser, clientRepository, firmMemberRepository, auditLogRepository);
}