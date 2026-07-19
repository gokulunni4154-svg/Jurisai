// src/modules/audit-log/audit-log.factory.ts
// Built directly against real billing.factory.ts source (pasted this
// session) for the construction pattern.
//
// Simpler shape than billing.factory.ts's two-client split: that factory
// needs both the RLS-respecting client (plans, firms — real
// `authenticated` SELECT policies exist) and the admin client
// (subscriptions — no RLS policy at all). audit_log is in the same
// position subscriptions is in: no RLS policy exists for it (see this
// module's migration header), so AuditLogRepository is constructed with
// the admin client exclusively — there's no RLS-scoped read this
// service ever needs to perform, since getMyAuditLog() (see
// audit-log.service.ts) filters by actorId in application code, not by
// relying on a database policy.
//
// AMENDED, THIS SESSION — AuditLogService now also needs a
// FirmRepository (for getFirmAuditLog()'s ownership check — see
// audit-log.service.ts's own header for the full reasoning on why that
// method exists at the Service layer rather than as a new RLS policy).
// This factory therefore now ALSO reaches for the RLS-respecting client,
// same shape billing.factory.ts and document.factory.ts already use:
// FirmRepository sits behind real `authenticated` SELECT policies
// (firms_select_owner / firms_select_member / firms_select_admin,
// confirmed via real firms table migration source), so — unlike
// AuditLogRepository — it does NOT need the admin client. The header
// comment above ("Simpler shape... AuditLogRepository is constructed
// with the admin client exclusively") is no longer a complete
// description of this factory as a whole; kept as-is above since it's
// still an accurate description of AuditLogRepository specifically, but
// flagging here so a future reader isn't misled into thinking this
// factory only ever touches one client.
//
// currentUser and the RLS-scoped `supabase` client are resolved once and
// shared with FirmRepository's construction, same reasoning
// document.factory.ts already documents for its own inline-constructed
// NotificationService: a single request-scoped resolution, not
// independently re-resolved per repository.

import { getCurrentUser } from '@/core/auth/session';
import { createAdminClient } from '@/core/supabase/admin';
import { createClient } from '@/core/supabase/server';
import { FirmRepository } from '@/modules/billing/firm.repository';

import { AuditLogService } from './audit-log.service';
import { AuditLogRepository } from './audit-log.repository';

export async function buildAuditLogService(): Promise<AuditLogService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const auditLogRepository = new AuditLogRepository(createAdminClient());
  const firmRepository = new FirmRepository(supabase);

  return new AuditLogService(currentUser, auditLogRepository, firmRepository);
}