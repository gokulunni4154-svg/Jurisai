// scripts/seed-plans.ts
//
// One-off script — NOT a migration, NOT wired into any route or CI step.
// Run manually once per environment: `tsx scripts/seed-plans.ts`
//
// First script in this project that calls an external API (Cashfree) to
// populate the DB, rather than a pure-SQL migration — see this session's
// discussion for why: cashfree_plan_id is environment-specific
// (sandbox vs production are separate Cashfree accounts), so it can't
// live in a replayable, environment-agnostic migration file the way
// schema always has in this project.
//
// PLACEHOLDER DATA — explicit instruction from the user: "not yet
// discussed about the cost, just write any three different amounts,
// will sort that later." Every price, slug, name, and interval below is
// a stand-in, NOT a real business decision. Do not treat price_paise
// values as final.
//
// FLAGGED, UNCONFIRMED CASHFREE CONTRACT DETAILS (guesses, not verified
// against a real sandbox call this session):
//   - planType: 'PERIODIC' for all three (recurring monthly billing,
//     not 'ON_DEMAND') — reasonable given these are subscription tiers,
//     not usage-based charges, but not independently confirmed.
//   - maxAmountRupees is set equal to recurringAmountRupees for all
//     three. Cashfree's plan_max_amount is documented as a cap Cashfree
//     enforces on the recurring charge; setting it equal to the
//     recurring amount assumes no future price increase within the same
//     plan is intended. Revisit if that's wrong.
//   - maxCycles is omitted (indefinite billing until cancelled) — not a
//     confirmed product decision, just the least-surprising default for
//     an unbounded subscription.
//   - The Cashfree-side plan_id reuses our own `slug` verbatim for
//     traceability (so a Cashfree dashboard lookup and a `plans.slug`
//     lookup are the same string). Undiscussed convention, flagged not
//     drawn from precedent.
//
// IDEMPOTENCY — deliberately checks findBySlug() before calling
// createPlan() for each tier and skips if a plans row with that slug
// already exists. Without this, re-running the script would both (a)
// hit Cashfree's own duplicate-plan_id conflict, since Cashfree plan
// ids are meant to be unique per account, and (b) violate
// `plans.slug`'s unique constraint on the DB insert. This makes the
// script safe to re-run after a partial failure (e.g. tier 2 of 3
// succeeds on Cashfree, then the process crashes before the DB insert)
// — already-seeded tiers are skipped, not re-created.
//
// AUTH — uses the service-role admin client (createAdminClient()), not
// the RLS-scoped server.ts client. Confirmed necessary: migration
// 20260726000000's own RLS section defines only plans_select_active/
// plans_select_admin (read-only) — there is no insert/update/delete
// policy for `authenticated` on `plans` at all. Same reasoning
// billing.factory.ts already uses for SubscriptionRepository.

import 'dotenv/config';

import { createAdminClient } from '@/core/supabase/admin';
import { CashfreeService } from '@/modules/billing/cashfree.service';
import { PlanRepository } from '@/modules/billing/plan.repository';
import type { CashfreePlanIntervalType, CashfreePlanType } from '@/modules/billing/cashfree.service';

interface PlanSeed {
  slug: string;
  name: string;
  billingTarget: 'individual' | 'lawyer' | 'firm';
  pricePaise: number;
  billingInterval: 'monthly' | 'yearly';
  planType: CashfreePlanType;
  intervalType: CashfreePlanIntervalType;
  maxSeats: number | null;
}

// PLACEHOLDER TIERS — three different amounts per the user's explicit
// instruction, real pricing to be decided later. Do not ship these.
const PLAN_SEEDS: PlanSeed[] = [
  {
    slug: 'individual-monthly',
    name: 'Individual',
    billingTarget: 'individual',
    pricePaise: 99900, // ₹999 — PLACEHOLDER
    billingInterval: 'monthly',
    planType: 'PERIODIC',
    intervalType: 'MONTH',
    maxSeats: null,
  },
  {
    slug: 'lawyer-monthly',
    name: 'Lawyer',
    billingTarget: 'lawyer',
    pricePaise: 249900, // ₹2,499 — PLACEHOLDER
    billingInterval: 'monthly',
    planType: 'PERIODIC',
    intervalType: 'MONTH',
    maxSeats: null,
  },
  {
    slug: 'firm-monthly',
    name: 'Law Firm',
    billingTarget: 'firm',
    pricePaise: 999900, // ₹9,999 — PLACEHOLDER
    billingInterval: 'monthly',
    planType: 'PERIODIC',
    intervalType: 'MONTH',
    maxSeats: 10, // PLACEHOLDER — real seat cap not yet decided
  },
];

async function main() {
  const supabase = createAdminClient();
  const planRepository = new PlanRepository(supabase);
  const cashfreeService = new CashfreeService();

  for (const seed of PLAN_SEEDS) {
    const existing = await planRepository.findBySlug(seed.slug);

    if (existing) {
      console.log(`Skipping '${seed.slug}' — already seeded (plans.id=${existing.id}).`);
      continue;
    }

    const amountRupees = seed.pricePaise / 100;

    console.log(`Creating Cashfree plan for '${seed.slug}'...`);

    const cashfreePlan = await cashfreeService.createPlan({
      planId: seed.slug,
      planName: seed.name,
      planType: seed.planType,
      recurringAmountRupees: amountRupees,
      maxAmountRupees: amountRupees,
      intervals: 1,
      intervalType: seed.intervalType,
      note: `Seeded ${seed.billingInterval} plan for JurisAI (${seed.billingTarget}) — placeholder pricing.`,
    });

    console.log(
      `Cashfree plan created: plan_id=${cashfreePlan.planId}, status=${cashfreePlan.planStatus}`,
    );

    const row = await planRepository.create({
      slug: seed.slug,
      name: seed.name,
      description: null,
      price_paise: seed.pricePaise,
      billing_interval: seed.billingInterval,
      billing_target: seed.billingTarget,
      max_seats: seed.maxSeats,
      cashfree_plan_id: cashfreePlan.planId,
      is_active: true,
    });

    console.log(`Inserted plans row: id=${row.id}, slug=${row.slug}`);
  }

  console.log('Done.');
}

main().catch((error) => {
  console.error('Plan seeding failed:', error);
  process.exit(1);
});