import { z } from 'zod';

import { uuidSchema } from '@/core/validation/common.schemas';

/**
 * Matches `plans.slug` (referenced by BillingService.createCheckoutSession()
 * — resolves plan by slug). No length/format constraint on `plans.slug`
 * has been pasted in this project, so this is deliberately loose (any
 * non-empty trimmed string) rather than guessing at a slug format (e.g.
 * kebab-case) that hasn't been confirmed against a real migration.
 */
export const planSlugSchema = z.string().trim().min(1, 'Plan is required.');

/**
 * Must match `firms.name`'s real check constraint
 * (`char_length(trim(name)) > 0 and char_length(name) <= 255`,
 * 20260726000002_create_firms_table.sql). Same rationale as
 * documents.schemas.ts's MAX_TITLE_LENGTH: reject a too-long/empty name
 * with a clear ValidationError before it ever reaches Postgres.
 */
export const FIRM_NAME_MAX_LENGTH = 255;

export const firmNameSchema = z
  .string()
  .trim()
  .min(1, 'Firm name is required.')
  .max(FIRM_NAME_MAX_LENGTH, `Firm name must be at most ${FIRM_NAME_MAX_LENGTH} characters.`);

/**
 * Basic shape validation only — not exhaustive RFC 5322 validation.
 * Matches the level of rigor documents.schemas.ts uses elsewhere in this
 * project (structural checks, not exhaustive format enforcement).
 */
export const customerEmailSchema = z.string().trim().email('A valid email is required.');

/**
 * Deliberately loose (digits, spaces, +, -, parens only) rather than a
 * strict E.164 pattern — Cashfree's own accepted phone-number format
 * has not been confirmed against real API docs/source this session.
 * Flagged in createCheckoutSchema's own comment below.
 */
export const customerPhoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+\-() ]{6,20}$/, 'A valid phone number is required.');

/**
 * Validates POST /api/billing/checkout's request body.
 *
 * customerName/customerEmail/customerPhone are taken as raw client input
 * here, NOT derived from a stored profile — this is a known, flagged gap
 * (Item #68). A bare ProfileRepository now exists (this session), but the
 * real `profiles` table's column names for these fields (e.g. full_name
 * vs first_name/last_name, whether phone is even a profiles column) have
 * never been pasted in any session, so BillingService cannot safely derive
 * them yet. This schema's shape should be revisited — likely dropping
 * these three fields entirely in favor of a profile lookup — once
 * `20260711120000_create_profiles_table.sql` is available to confirm the
 * real column names.
 *
 * firmId is optional at the schema layer deliberately: this schema has no
 * way to know whether the resolved plan's billing_target is 'individual'
 * | 'lawyer' | 'firm', so "firmId required" is a business rule enforced in
 * BillingService.createCheckoutSession() (which already resolves the plan
 * before checking for firmId), not something this schema can express
 * without querying the database itself.
 */
export const createCheckoutSchema = z
  .object({
    planSlug: planSlugSchema,
    firmId: uuidSchema.optional(),
    customerName: z.string().trim().min(1, 'Name is required.').max(255),
    customerEmail: customerEmailSchema,
    customerPhone: customerPhoneSchema,
  })
  .strict();

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

/**
 * Validates POST /api/billing/firms's request body (Item #67, this
 * session). Only `name` is client-supplied — `owner_id` is always the
 * authenticated user, set server-side in FirmService.createFirm(), never
 * taken from request input (a client should never be able to create a
 * firm on someone else's behalf).
 */
export const createFirmSchema = z
  .object({
    name: firmNameSchema,
  })
  .strict();

export type CreateFirmInput = z.infer<typeof createFirmSchema>;

/**
 * Validates the SUBSCRIPTION_STATUS_CHANGED webhook payload's relevant
 * subset. Shape confirmed against real Cashfree docs this session
 * (Subscriptions API, webhook version 2025-01-01):
 * https://www.cashfree.com/docs/api-reference/payments/latest/subscription/webhooks
 *
 * This closes the ambiguity Item #64 flagged — the real field is
 * `data.subscription_details.subscription_status`, NOT a top-level
 * `subscription_status` or `status` as `cashfree.service.ts`'s
 * defensive `raw.subscription_status ?? raw.status ?? 'INITIALIZED'`
 * check (createSubscription()'s *response*, a related but different
 * shape) had guessed at. `cashfree.service.ts` itself should be
 * revisited with this confirmed shape in mind, though its check was for
 * the create-subscription API response, not this webhook payload — the
 * two are not necessarily the same shape and this schema does not
 * assume they are.
 *
 * Deliberately `.passthrough()`, not `.strict()` — unlike every other
 * schema in this file. The real payload carries plan_details,
 * customer_details, authorization_details, and payment_gateway_details
 * alongside subscription_details (see the docs example), none of which
 * this handler currently needs. `.strict()` would reject the real
 * payload outright; `.passthrough()` validates only the fields this
 * handler actually reads and ignores the rest.
 *
 * `subscription_status`'s enum is deliberately NOT constrained to
 * fix_subscription_status_values.sql's real CHECK-constraint list here
 * — the real docs list two values that migration's CHECK constraint
 * does NOT currently allow (CANCELLED, CARD_EXPIRED), alongside the
 * eight it does. Constraining this schema to the DB's list would mean a
 * real, valid Cashfree webhook for one of those two statuses gets
 * rejected by this schema before ever reaching the DB to fail there.
 * Flagged as a new, concrete follow-up: the CHECK constraint likely
 * needs a follow-up migration adding CANCELLED and CARD_EXPIRED, not
 * this schema loosened to hide the mismatch.
 */
export const cashfreeSubscriptionStatusChangedSchema = z
  .object({
    type: z.literal('SUBSCRIPTION_STATUS_CHANGED'),
    event_time: z.string(),
    data: z
      .object({
        subscription_details: z
          .object({
            cf_subscription_id: z.string(),
            subscription_id: z.string(),
            subscription_status: z.string(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export type CashfreeSubscriptionStatusChangedPayload = z.infer<
  typeof cashfreeSubscriptionStatusChangedSchema
>;

/**
 * Loose envelope schema for any Cashfree subscription webhook, used only
 * to read `type` before deciding which specific schema to parse the
 * full payload against. Every event this project has seen documented
 * shares this `{ type, event_time, data }` envelope shape (see the same
 * docs page cited above for SUBSCRIPTION_PAYMENT_SUCCESS,
 * SUBSCRIPTION_PAYMENT_FAILED, etc.) — only `type`'s literal set is
 * event-specific, which is why cashfreeSubscriptionStatusChangedSchema
 * above re-declares the full shape rather than extending this one.
 */
export const cashfreeWebhookEnvelopeSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();