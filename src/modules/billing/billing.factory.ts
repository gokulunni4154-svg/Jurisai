// src/modules/billing/billing.factory.ts
// Built directly against real document.factory.ts / notification.factory.ts
// source (both pasted this session) for the inline-construction pattern,
// and real admin.ts source for the service-role client.
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

import { getCurrentUser } from '@/core/auth/session';
import { createAdminClient } from '@/core/supabase/admin';
import { createClient } from '@/core/supabase/server';

import { BillingService } from './billing.service';
import { CashfreeService } from './cashfree.service';
import { FirmRepository } from './firm.repository';
import { PlanRepository } from './plan.repository';
import { SubscriptionRepository } from './subscription.repository';

export async function buildBillingService(): Promise<BillingService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const planRepository = new PlanRepository(supabase);
  const firmRepository = new FirmRepository(supabase);

  // Deliberately a DIFFERENT client instance from `supabase` above — see
  // this file's header. createAdminClient() is a cached module-level
  // singleton (per admin.ts's own doc comment), not request-scoped, but
  // that's safe here since it carries no per-user session to isolate.
  const subscriptionRepository = new SubscriptionRepository(createAdminClient());

  const cashfreeService = new CashfreeService();

  return new BillingService(
    currentUser,
    planRepository,
    subscriptionRepository,
    firmRepository,
    cashfreeService,
  );
}