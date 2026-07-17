import { z } from 'zod';
import { emailSchema, nonEmptyStringSchema } from '@/core/validation/common.schemas';
import { profileFullNameSchema } from '@/modules/profiles/profile.schemas';

/**
 * Must match `minimum_password_length` in supabase/config.toml (File 12).
 * Kept as an application-level check so a weak password is rejected with a
 * clear ValidationError before ever reaching the Supabase Auth API, rather
 * than surfacing as an opaque Auth error. If File 12's value ever changes,
 * this constant must change with it.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Upper bound of 72 reflects bcrypt's well-known input-length limit, which
 * Supabase Auth's password hashing inherits. Characters beyond 72 are
 * silently ignored by bcrypt rather than rejected, which would otherwise
 * let two different long passwords hash identically -- rejecting upfront
 * is more honest than allowing that surprise.
 */
export const MAX_PASSWORD_LENGTH = 72;

/**
 * Full password-strength policy. Used at sign-up and at password change --
 * anywhere a *new* password is being set.
 */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);

/**
 * Sign-up payload.
 *
 * `fullName` reuses profileFullNameSchema (File 27) rather than declaring
 * its own constraint -- this value flows directly into
 * raw_user_meta_data.full_name, which File 25's handle_new_user() trigger
 * copies into profiles.full_name. It is the same constraint under a
 * different name, so it has one schema, not two that could drift apart.
 */
export const signUpSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    fullName: profileFullNameSchema,
  })
  .strict();

export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Sign-in payload.
 *
 * Deliberately does NOT run password through the full passwordSchema
 * policy -- only nonEmptyStringSchema. A real password created under an
 * older, weaker, or since-changed policy must still be checkable at login;
 * rejecting it here with a "too short" message would be misleading (the
 * actual failure, if any, is an authentication failure, not a validation
 * failure).
 */
export const signInSchema = z
  .object({
    email: emailSchema,
    password: nonEmptyStringSchema,
  })
  .strict();

export type SignInInput = z.infer<typeof signInSchema>;

/**
 * Request a password-reset email. Email only -- deliberately reveals
 * nothing about whether the address is registered; that determination
 * (and the decision to always return a generic success response either
 * way) belongs to the future AuthService, not this schema.
 */
export const requestPasswordResetSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

/**
 * Set a new password, either during an authenticated password change or
 * completing a reset flow. Uses the full passwordSchema policy, since this
 * always sets a brand-new password.
 */
export const updatePasswordSchema = z
  .object({
    newPassword: passwordSchema,
  })
  .strict();

export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;