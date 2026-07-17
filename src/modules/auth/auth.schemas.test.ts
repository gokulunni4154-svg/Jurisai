import { describe, it, expect } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  passwordSchema,
  signUpSchema,
  signInSchema,
  requestPasswordResetSchema,
  updatePasswordSchema,
} from './auth.schemas';

describe('password policy constants', () => {
  it('MIN_PASSWORD_LENGTH matches supabase/config.toml minimum_password_length (File 12)', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('MAX_PASSWORD_LENGTH reflects bcrypt input-length limit', () => {
    expect(MAX_PASSWORD_LENGTH).toBe(72);
  });
});

describe('passwordSchema', () => {
  it('rejects a password one character below the minimum', () => {
    const result = passwordSchema.safeParse('a'.repeat(MIN_PASSWORD_LENGTH - 1));
    expect(result.success).toBe(false);
  });

  it('accepts a password exactly at the minimum length', () => {
    const result = passwordSchema.safeParse('a'.repeat(MIN_PASSWORD_LENGTH));
    expect(result.success).toBe(true);
  });

  it('accepts a password exactly at the maximum length', () => {
    const result = passwordSchema.safeParse('a'.repeat(MAX_PASSWORD_LENGTH));
    expect(result.success).toBe(true);
  });

  it('rejects a password one character above the maximum', () => {
    const result = passwordSchema.safeParse('a'.repeat(MAX_PASSWORD_LENGTH + 1));
    expect(result.success).toBe(false);
  });
});

describe('signUpSchema', () => {
  const validPayload = {
    email: 'new.user@example.com',
    password: 'a-strong-password-123',
    fullName: 'Asha Verma',
  };

  it('accepts a valid sign-up payload', () => {
    const result = signUpSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects a malformed email', () => {
    const result = signUpSchema.safeParse({ ...validPayload, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a password below the minimum length', () => {
    const result = signUpSchema.safeParse({
      ...validPayload,
      password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a full name over 255 characters (matches profiles table check constraint)', () => {
    const result = signUpSchema.safeParse({
      ...validPayload,
      fullName: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a full name at exactly 255 characters', () => {
    const result = signUpSchema.safeParse({
      ...validPayload,
      fullName: 'a'.repeat(255),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing a required field', () => {
    const { fullName: _fullName, ...incomplete } = validPayload;
    const result = signUpSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it('rejects an unexpected extra field (.strict())', () => {
    const result = signUpSchema.safeParse({ ...validPayload, role: 'admin' });
    expect(result.success).toBe(false);
  });
});

describe('signInSchema', () => {
  it('accepts a valid sign-in payload', () => {
    const result = signInSchema.safeParse({
      email: 'user@example.com',
      password: 'whatever-they-originally-chose',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a password that would fail the full password-strength policy', () => {
    // Deliberately weaker than signUpSchema: a real password created under
    // an older or since-changed policy must still be checkable at login.
    // This is signInSchema's one intentional asymmetry with signUpSchema
    // and updatePasswordSchema -- pinned down here so it isn't accidentally
    // "fixed" into symmetry later.
    const result = signInSchema.safeParse({
      email: 'user@example.com',
      password: 'short',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty password', () => {
    const result = signInSchema.safeParse({
      email: 'user@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    const result = signInSchema.safeParse({
      email: 'not-an-email',
      password: 'whatever-they-originally-chose',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unexpected extra field (.strict())', () => {
    const result = signInSchema.safeParse({
      email: 'user@example.com',
      password: 'whatever-they-originally-chose',
      rememberMe: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('requestPasswordResetSchema', () => {
  it('accepts a valid email', () => {
    const result = requestPasswordResetSchema.safeParse({ email: 'user@example.com' });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed email', () => {
    const result = requestPasswordResetSchema.safeParse({ email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects an unexpected extra field (.strict())', () => {
    const result = requestPasswordResetSchema.safeParse({
      email: 'user@example.com',
      redirectTo: 'https://evil.example.com',
    });
    expect(result.success).toBe(false);
  });
});

describe('updatePasswordSchema', () => {
  it('accepts a new password meeting the full strength policy', () => {
    const result = updatePasswordSchema.safeParse({
      newPassword: 'a-new-strong-password-456',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a new password below the minimum length', () => {
    const result = updatePasswordSchema.safeParse({
      newPassword: 'a'.repeat(MIN_PASSWORD_LENGTH - 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unexpected extra field (.strict())', () => {
    const result = updatePasswordSchema.safeParse({
      newPassword: 'a-new-strong-password-456',
      currentPassword: 'old-password',
    });
    expect(result.success).toBe(false);
  });
});
