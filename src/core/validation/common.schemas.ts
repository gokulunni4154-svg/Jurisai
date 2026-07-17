import { z } from 'zod';

/**
 * common.schemas.ts
 * ------------------
 * Shared, reusable Zod primitives for validating untrusted input (request
 * bodies, query params, search params) before it reaches a Service or
 * Repository. This file has zero knowledge of any domain table — it holds
 * only cross-cutting building blocks (UUIDs, emails, pagination, non-empty
 * strings, ISO datetimes) that domain-specific schemas will compose from.
 *
 * Domain schemas (e.g. createUserProfileSchema) belong colocated with their
 * own module once that module exists (e.g. src/modules/profiles/), and
 * should import primitives from here rather than redefine them.
 *
 * Convention: call `schema.parse(input)`, not `schema.safeParse(input)`, at
 * every validation boundary that should be reported as a 400 to the client.
 * A thrown ZodError from `.parse()` is automatically caught and converted
 * into a ValidationError (with `fieldErrors` in its server-log-only
 * context) by `normalizeError()` in src/core/errors/error-handler.ts
 * (File 21). Using `.safeParse()` opts out of that automatic handling and
 * requires the caller to translate the result manually — only do this if
 * you have a specific reason not to surface a standard 400.
 */

/** Hard upper bound on any paginated query's page size. Enforced here, at
 * the validation boundary, rather than left to BaseRepository.findMany()
 * (File 22), which has no limit of its own — without this cap, a caller
 * could request an unbounded result set directly from Postgrest. */
export const MAX_PAGE_SIZE = 100;

/** Default page size when the caller does not specify one. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Validates a single UUID string, e.g. a resource id from a route param.
 */
export const uuidSchema = z.string().uuid({ message: 'Must be a valid UUID.' });

/**
 * Validates pagination query params. Uses z.coerce.number() because
 * pagination values arrive as strings on the wire (e.g. `?limit=20`), not
 * as numbers — coercion happens as part of validation, not before it.
 * `limit` is capped at MAX_PAGE_SIZE and defaults to DEFAULT_PAGE_SIZE if
 * omitted; `offset` defaults to 0 and cannot be negative.
 */
export const paginationSchema = z.object({
  limit: z.coerce
    .number({ invalid_type_error: 'limit must be a number.' })
    .int('limit must be an integer.')
    .positive('limit must be greater than 0.')
    .max(MAX_PAGE_SIZE, `limit cannot exceed ${MAX_PAGE_SIZE}.`)
    .default(DEFAULT_PAGE_SIZE),
  offset: z.coerce
    .number({ invalid_type_error: 'offset must be a number.' })
    .int('offset must be an integer.')
    .min(0, 'offset cannot be negative.')
    .default(0),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

/**
 * Validates and normalizes an email address. Trims surrounding whitespace
 * and lowercases the value as part of parsing (not just validating), so
 * every call site that has validated an email is guaranteed to already
 * have it in comparable, storable form — avoiding a separate, easy-to-forget
 * normalization step downstream.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'Must be a valid email address.' });

/**
 * Validates a required text field: trims whitespace, rejects empty or
 * whitespace-only strings. Does NOT case-fold — arbitrary text fields
 * (names, titles, free text) should not be silently lowercased the way
 * emails are.
 */
export const nonEmptyStringSchema = z
  .string()
  .trim()
  .min(1, 'This field cannot be empty.');

/**
 * Validates an ISO 8601 datetime string, e.g. for appointment/booking
 * timestamps submitted as JSON strings.
 */
export const isoDateTimeSchema = z
  .string()
  .datetime({ message: 'Must be a valid ISO 8601 datetime string.' });