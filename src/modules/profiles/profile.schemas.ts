import { z } from 'zod';
import { nonEmptyStringSchema, uuidSchema } from '@/core/validation/common.schemas';

/**
 * profile.schemas.ts
 * --------------------
 * Zod schemas for validating untrusted input to the profiles module (route
 * handler bodies / params) before it reaches ProfileService / ProfileRepository.
 * Composes shared primitives from src/core/validation/common.schemas.ts
 * (File 24) rather than redefining string/URL validation from scratch.
 *
 * Field-level limits below intentionally mirror the CHECK constraints in
 * supabase/migrations/20260711120000_create_profiles_table.sql (File 25).
 * If that migration's constraints ever change, these must be updated to
 * match -- otherwise a too-long value would pass validation here only to
 * fail at the database as an opaque DatabaseError (500) instead of a clean
 * ValidationError (400) with a field-specific message.
 */

/** Matches profiles_full_name_length in File 25's migration. */
const MAX_FULL_NAME_LENGTH = 255;

/** Matches profiles_phone_length in File 25's migration. */
const MAX_PHONE_LENGTH = 20;

/**
 * India-specific mobile number format: a 10-digit number starting 6-9,
 * optionally prefixed with +91 (with or without a separating space/hyphen).
 * Deliberately narrow to JurisAI's current India-only market, matching
 * established conventions elsewhere in this codebase (INR pricing,
 * WhatsApp-first patterns). Revisit if the product ever expands beyond
 * India -- this is a scoped assumption, not an oversight.
 */
const INDIAN_MOBILE_REGEX = /^(\+91[-\s]?)?[6-9]\d{9}$/;

export const profileFullNameSchema = nonEmptyStringSchema.max(
  MAX_FULL_NAME_LENGTH,
  `Full name cannot exceed ${MAX_FULL_NAME_LENGTH} characters.`
);

export const profileAvatarUrlSchema = z
  .string()
  .trim()
  .url('Avatar must be a valid URL.');

export const profilePhoneSchema = z
  .string()
  .trim()
  .max(MAX_PHONE_LENGTH, `Phone number cannot exceed ${MAX_PHONE_LENGTH} characters.`)
  .regex(
    INDIAN_MOBILE_REGEX,
    'Must be a valid Indian mobile number, e.g. 9847012345 or +919847012345.'
  );

/**
 * Validates the input to ProfileService.updateOwnProfile() (File 28).
 *
 * Every field is optional AND nullable, with a deliberate distinction:
 *   - an OMITTED key means "leave this field unchanged"
 *   - an explicit `null` means "clear this field"
 * A form component must translate a cleared input to `null`, not `""` or
 * an omitted key, for that intent to come through correctly.
 *
 * .strict() rejects any key not listed below (e.g. a stray `role` or `id`
 * in the request body) with a ZodError, rather than silently stripping it
 * the way a plain z.object() would -- silent stripping would hide a client
 * bug instead of surfacing it as a 400.
 *
 * .refine() rejects a fully-empty payload ({}), which would otherwise pass
 * (every field is optional) and trigger a pointless no-op UPDATE.
 */
export const updateProfileSchema = z
  .object({
    full_name: profileFullNameSchema.nullable().optional(),
    avatar_url: profileAvatarUrlSchema.nullable().optional(),
    phone: profilePhoneSchema.nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Validates a profile id supplied via a route param, e.g.
 * GET /api/profiles/[id] or PATCH /api/profiles/[id].
 */
export const profileIdParamSchema = z.object({
  id: uuidSchema,
});

export type ProfileIdParam = z.infer<typeof profileIdParamSchema>;