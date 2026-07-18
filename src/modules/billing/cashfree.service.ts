// src/modules/billing/cashfree.service.ts
// File number not yet assigned — see PROJECT_PROGRESS.md Item #53's
// running list of unnumbered files.
//
// FLAGGED DESIGN DECISION — does NOT extend BaseService. Every other
// Service in this project (confirmed via real DocumentService source,
// File 48) extends BaseService and is constructed with
// `currentUser: AuthUser | null`, using requireAuthentication()/
// requireOwnership() to gate methods against Supabase-row ownership.
// CashfreeService has no row to own — it's a stateless wrapper around an
// external HTTP API, with no per-user authorization concept of its own.
// Whatever calls this Service (a checkout Route Handler, a future
// CheckoutService) is responsible for its own requireAuthentication()
// before ever reaching this class. Treating this as a BaseService subtype
// would mean inventing a currentUser-shaped authorization check that
// doesn't correspond to anything this class actually does.
//
// FLAGGED — this project's real error-handling convention for a FAILED
// EXTERNAL API CALL has never been confirmed. DocumentService imports
// AuthorizationError/NotFoundError from '@/core/errors/app-error', but
// those model Supabase-row authorization/existence failures, not
// "a third-party HTTP API returned a non-2xx response" — a different
// failure class. GoogleVisionOCRProvider (File 71) is referenced in
// env.server.ts's own comments as this project's first external-API
// integration, but its real source has never been pasted in any session,
// so I cannot confirm it established a reusable pattern for this. A local
// CashfreeApiError is defined below instead of assuming a shared
// ExternalServiceError exists in '@/core/errors/app-error' — please paste
// that file if one already exists so this can be corrected to reuse it.
//
// FLAGGED — API version pinned to '2023-08-01' as a module-level constant,
// not an env var (it's a contract choice, not a secret/environment
// concern). Confirmed field-for-field against Cashfree's real docs this
// session at this version. A newer '2025-01-01' version was seen
// referenced in one doc example (iOS SDK snippet) but its field-level
// differences from '2023-08-01', if any, were NOT independently verified
// — pinning to the older, fully-confirmed version deliberately rather
// than guessing the newer one is backward-compatible.
//
// FLAGGED — only createPlan() and createSubscription() are built here,
// matching what this session actually verified against real Cashfree
// docs (POST /pg/plans, POST /pg/subscriptions). Other operations that
// exist in Cashfree's API (Get Subscription Details, Manage Subscription,
// Fetch Payments, etc.) are NOT built — adding them now would mean
// guessing their shapes from nav-menu labels alone, which this session
// did not fetch and verify. Build those as separate, real, source-checked
// methods when the checkout/webhook flow actually needs them.

import 'server-only';

import { serverEnv } from '@/core/config/env.server';

const CASHFREE_API_VERSION = '2023-08-01';

const CASHFREE_BASE_URL =
  serverEnv.CASHFREE_ENVIRONMENT === 'production'
    ? 'https://api.cashfree.com'
    : 'https://sandbox.cashfree.com';

/**
 * Thrown when Cashfree's API returns a non-2xx response. Deliberately
 * NOT one of '@/core/errors/app-error''s existing classes — see this
 * file's header comment. Carries the raw response body (parsed if JSON,
 * raw text otherwise) so a caller can inspect Cashfree's real error
 * shape without this class needing to model it upfront.
 */
export class CashfreeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'CashfreeApiError';
  }
}

export type CashfreePlanType = 'PERIODIC' | 'ON_DEMAND';

export type CashfreePlanIntervalType = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

/**
 * Input for creating a Cashfree plan. Field names below are OUR
 * camelCase convention (matching this project's TypeScript-side style
 * elsewhere, e.g. documents.schemas.ts) — mapToRequestBody() below
 * translates them to Cashfree's real snake_case wire format
 * (plan_id, plan_name, etc.), confirmed this session against their
 * actual /pg/plans docs.
 */
export interface CreateCashfreePlanInput {
  planId: string;
  planName: string;
  planType: CashfreePlanType;
  /** Smallest currency unit is NOT used here — Cashfree's real
   *  plan_recurring_amount/plan_max_amount fields are plain rupee
   *  amounts (their docs' own example uses `10` for ₹10), unlike our
   *  own `plans.price_paise` column. Conversion from price_paise to a
   *  rupee amount is the CALLER's responsibility, not this method's —
   *  flagged so the paise->rupee conversion isn't silently duplicated
   *  or forgotten at a different layer. */
  recurringAmountRupees: number;
  maxAmountRupees: number;
  maxCycles?: number;
  intervals: number;
  intervalType: CashfreePlanIntervalType;
  note?: string;
  currency?: string;
}

export interface CashfreePlanResponse {
  planId: string;
  planName: string;
  planType: CashfreePlanType;
  planCurrency: string;
  planStatus: string;
  raw: unknown;
}

export interface CreateCashfreeSubscriptionCustomerDetails {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

export interface CreateCashfreeSubscriptionInput {
  subscriptionId: string;
  planId: string;
  customer: CreateCashfreeSubscriptionCustomerDetails;
  authorizationAmountRupees: number;
  returnUrl: string;
  /** EMAIL/SMS notification channels — matches Cashfree's real
   *  `notification_channel` on `subscription_meta`. Defaults to
   *  ['EMAIL'] if omitted; not confirmed as a *product* decision with
   *  you, just a reasonable default so this parameter can stay
   *  optional. */
  notificationChannels?: Array<'EMAIL' | 'SMS'>;
}

export interface CashfreeSubscriptionResponse {
  subscriptionId: string;
  cfSubscriptionId: string | null;
  status: string;
  raw: unknown;
}

/**
 * Stateless wrapper around Cashfree's real Subscriptions API
 * (POST /pg/plans, POST /pg/subscriptions), confirmed against their
 * current (2023-08-01+) docs, not the deprecated v1/"previous" docs.
 * No constructor dependencies — every call reads credentials from the
 * already-validated `serverEnv` singleton, same as every other
 * env-var-consuming module in this project.
 */
export class CashfreeService {
  private buildHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'x-api-version': CASHFREE_API_VERSION,
      'x-client-id': serverEnv.CASHFREE_CLIENT_ID,
      'x-client-secret': serverEnv.CASHFREE_CLIENT_SECRET,
    };
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${CASHFREE_BASE_URL}${path}`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    const contentType = response.headers.get('content-type') ?? '';
    const parsedBody = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      throw new CashfreeApiError(
        `Cashfree API request to ${path} failed with status ${response.status}`,
        response.status,
        parsedBody,
      );
    }

    return parsedBody as T;
  }

  /**
   * Creates a plan via POST /pg/plans. Cashfree's real request body
   * (confirmed this session): plan_id, plan_name, plan_type,
   * plan_currency, plan_recurring_amount, plan_max_amount,
   * plan_max_cycles, plan_intervals, plan_interval_type, plan_note.
   */
  async createPlan(input: CreateCashfreePlanInput): Promise<CashfreePlanResponse> {
    const body = {
      plan_id: input.planId,
      plan_name: input.planName,
      plan_type: input.planType,
      plan_currency: input.currency ?? 'INR',
      plan_recurring_amount: input.recurringAmountRupees,
      plan_max_amount: input.maxAmountRupees,
      ...(input.maxCycles !== undefined ? { plan_max_cycles: input.maxCycles } : {}),
      plan_intervals: input.intervals,
      plan_interval_type: input.intervalType,
      ...(input.note !== undefined ? { plan_note: input.note } : {}),
    };

    const raw = await this.request<{
      plan_id: string;
      plan_name: string;
      plan_type: CashfreePlanType;
      plan_currency: string;
      plan_status: string;
    }>('/pg/plans', body);

    return {
      planId: raw.plan_id,
      planName: raw.plan_name,
      planType: raw.plan_type,
      planCurrency: raw.plan_currency,
      planStatus: raw.plan_status,
      raw,
    };
  }

  /**
   * Creates a subscription via POST /pg/subscriptions, referencing an
   * existing plan by ID (plan_details.plan_id) rather than sending
   * inline plan fields — this project's plans are pre-created rows in
   * our own `plans` table with a real Cashfree plan already provisioned
   * (see createPlan above), so there's no need for the
   * inline-plan-fields variant Cashfree's docs also support.
   *
   * `cf_subscription_id` in the real response can be null immediately
   * after creation (Cashfree's own docs describe an initial
   * unauthorized state) — CashfreeSubscriptionResponse models this as
   * `string | null`, not assumed always-present.
   */
  async createSubscription(
    input: CreateCashfreeSubscriptionInput,
  ): Promise<CashfreeSubscriptionResponse> {
    const body = {
      subscription_id: input.subscriptionId,
      customer_details: {
        customer_name: input.customer.customerName,
        customer_email: input.customer.customerEmail,
        customer_phone: input.customer.customerPhone,
      },
      plan_details: {
        plan_id: input.planId,
      },
      authorization_details: {
        authorization_amount: input.authorizationAmountRupees,
      },
      subscription_meta: {
        return_url: input.returnUrl,
        notification_channel: input.notificationChannels ?? ['EMAIL'],
      },
    };

    const raw = await this.request<{
      subscription_id: string;
      cf_subscription_id: string | null;
      subscription_status?: string;
      status?: string;
    }>('/pg/subscriptions', body);

    return {
      subscriptionId: raw.subscription_id,
      cfSubscriptionId: raw.cf_subscription_id,
      // FLAGGED: the response's status field name (subscription_status
      // vs status) was not pinned down precisely across the docs
      // snippets seen this session — both are checked defensively here
      // rather than assuming one. Confirm the real field name against
      // an actual sandbox response and remove whichever doesn't exist.
      status: raw.subscription_status ?? raw.status ?? 'INITIALIZED',
      raw,
    };
  }
}