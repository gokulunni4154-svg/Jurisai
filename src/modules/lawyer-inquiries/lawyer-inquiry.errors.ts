// src/modules/lawyer-inquiries/lawyer-inquiry.errors.ts
//
// Maps the stable error messages raised by the inquiry Postgres functions
// (open_lawyer_inquiry_review / accept_lawyer_inquiry / decline_lawyer_inquiry)
// onto the app's own error classes, so handleApiError() produces the usual
// status codes. Anything unrecognised is rethrown untouched (a real database
// failure must stay a 500, never be disguised as a 4xx).

import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/core/errors/app-error';

const VALIDATION_MESSAGES: Readonly<Record<string, string>> = {
  assignee_required: 'Choose a lawyer in your firm to assign this inquiry to.',
  assignee_not_permitted: 'This inquiry is already addressed to a specific lawyer.',
  assignee_not_firm_member: 'The selected lawyer is not a member of this firm.',
  assignee_not_lawyer: 'Inquiries can only be assigned to a lawyer, owner or admin of the firm.',
  team_not_in_firm: 'The selected team does not belong to this firm.',
  invalid_title: 'A case title of 1 to 255 characters is required.',
  invalid_note: 'The note must be 1000 characters or fewer.',
};

const CONFLICT_MESSAGES: Readonly<Record<string, string>> = {
  inquiry_declined: 'This inquiry was declined.',
  inquiry_already_accepted: 'This inquiry has already been accepted.',
  review_window_expired: 'The 7-day review window for this inquiry has expired.',
  review_not_available: 'This inquiry is no longer open for pre-acceptance review.',
};

function messageOf(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    return typeof m === 'string' ? m : null;
  }
  return null;
}

/**
 * Throws the mapped app error, or rethrows the original. Always throws.
 * `hideExistence` makes "not found" and "not authorized" indistinguishable
 * (both NotFound) -- used by the review endpoints so a caller cannot probe
 * which inquiry ids exist.
 */
export function rethrowInquiryRpcError(error: unknown, options?: { hideExistence?: boolean }): never {
  const message = messageOf(error);

  if (message === 'inquiry_not_found') {
    throw new NotFoundError('Inquiry not found.');
  }
  if (message === 'not_authorized') {
    if (options?.hideExistence) {
      throw new NotFoundError('Inquiry not found.');
    }
    throw new AuthorizationError('You do not have permission to act on this inquiry.');
  }
  if (message === 'review_access_revoked') {
    throw new AuthorizationError('Your review access to this inquiry has ended.');
  }
  if (message && message in CONFLICT_MESSAGES) {
    throw new ConflictError(CONFLICT_MESSAGES[message] as string);
  }
  if (message && message in VALIDATION_MESSAGES) {
    throw new ValidationError(VALIDATION_MESSAGES[message] as string);
  }

  throw error;
}
