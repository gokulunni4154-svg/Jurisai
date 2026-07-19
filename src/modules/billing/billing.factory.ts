// src/modules/billing/billing.factory.ts
// Built directly against real document.factory.ts / notification.factory.ts
// source (both pasted in a prior session) for the inline-construction
// pattern, and real admin.ts source for the service-role client.
//
// FLAGGED, GENUINELY NEW PATTERN — every prior factory in this project
// (buildDocumentService, buildNotificationService, and by extension every
// inline-constructed sibling inside them) uses exactly ONE Supabase
// client instance, always createClient() (the RLS-respecting one),
// shared across every repository it builds. This factory cannot do that:
// subscription.repository.ts's own doc comment states plainly that
// `subscriptions` has no insert/update RLS policy for `authenticated` at
// all, so SubscriptionRepository MUST be constructed with the admin.ts
// service-role client or every write fails outright. PlanRepository and
// FirmRepository, by contrast, read tables with real `authenticated`
// SELECT policies (plans_select_active, firms_select_owner/
// firms_select_member) — they use the ordinary RLS client, same as
// every precedent factory.
//
// This means BillingService now depends on data resolved two different
// ways in the same request: currentUser/RLS-scoped reads reflect exactly
// what that user is allowed to see, while the subscription write bypasses
// RLS entirely. This is intentional and matches admin.ts's own stated
// use case ("acts on behalf of a specific logged-in user" for the reads,
// but the actual persistence step has no RLS policy to act *as* the user
// under at all) — flagged here so a future reviewer doesn't assume this
// factory's two-client shape is an oversight.
//
// NEW, THIS SESSION — AuditLogRepository added as a 5th dependency for
// BillingService, matching that Service's own new constructor signature
// (see billing.service.ts's header for why AuditLogRepository is
// injected directly rather than via AuditLogService). audit_log has no
// RLS policy at all (same category as `subscriptions`), so this
// repository is also constructed with the admin client — reusing the
// SAME admin client instance already created for subscriptionRepository
// below rather than calling createAdminClient() a second time, since
// admin.ts's own doc comment describes it as a cached module-level
// singleton anyway; one call site is simpler than two doing the same
// thing.
//
// NEW, THIS SESSION — ProfileRepository added as a 6th dependency for
// BillingService, matching that Service's own new constructor signature
// (createCheckoutSession() now derives customerName/customerPhone from
// the caller's own profile instead of accepting them from the client).
// Import path CONFIRMED this session via billing.service.ts's own real,
// pasted source (`import type { ProfileRepository } from
// './profile.repository';`) — it lives in this same module folder
// (src/modules/billing/profile.repository.ts), not a separate `profiles`
// module as an earlier draft of this file guessed.
//
// Constructed against the RLS-respecting `supabase` client (same group
// as planRepository/firmRepository above), NOT the admin client.
// CONFIRMED this session via profiles' real, pasted creation migration
// (20260711120000_create_profiles_table.sql): a `profiles_select_own`
// policy exists (`using (id = auth.uid())`), and
// billing.service.ts's only use of ProfileRepository is exactly that
// case — findByIdOrThrow(user.id), the caller reading their own row
// during checkout. An earlier draft of this file used the admin client
// here instead, reasoning from firm.factory.ts's real precedent (which
// DOES use the admin client for ProfileRepository) — but that precedent
// is for a WRITE (profiles.firm_id, a column this migration predates
// and doesn't cover), a different operation with different RLS
// requirements. The two factories legitimately differ: this one's
// read-only self-lookup is RLS-safe and confirmed; firm.factory.ts's
// write may or may not be, still unconfirmed for that column
// specifically, but that's firm.factory.ts's own concern, not this
// file's.

import { getCurrentUser } from '@/core/auth/session';
import { createAdminClient } from '@/core/supabase/admin';
import { createClient } from '@/core/supabase/server';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

import { BillingService } from './billing.service';
import { CashfreeService } from './cashfree.service';
import { FirmRepository } from './firm.repository';
import { PlanRepository } from './plan.repository';
import { ProfileRepository } from './profile.repository';
import { SubscriptionRepository } from './subscription.repository';

export async function buildBillingService(): Promise<BillingService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const planRepository = new PlanRepository(supabase);
  const firmRepository = new FirmRepository(supabase);
  // RLS-respecting client, same as planRepository/firmRepository above —
  // see header note: confirmed correct via profiles' real
  // profiles_select_own policy, which exactly covers this Service's
  // only use (self-read via findByIdOrThrow(user.id)).
  const profileRepository = new ProfileRepository(supabase);

  // Deliberately a DIFFERENT client instance from `supabase` above — see
  // this file's header. createAdminClient() is a cached module-level
  // singleton (per admin.ts's own doc comment), not request-scoped, but
  // that's safe here since it carries no per-user session to isolate.
  const adminClient = createAdminClient();
  const subscriptionRepository = new SubscriptionRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  const cashfreeService = new CashfreeService();

  return new BillingService(
    currentUser,
    planRepository,
    subscriptionRepository,
    firmRepository,
    cashfreeService,
    auditLogRepository,
    profileRepository,
  );
}