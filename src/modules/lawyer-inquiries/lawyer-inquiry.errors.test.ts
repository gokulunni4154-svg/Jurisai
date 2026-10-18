import { describe, expect, it } from 'vitest';

import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@/core/errors/app-error';

import { rethrowInquiryRpcError } from './lawyer-inquiry.errors';

const run = (message: string, options?: { hideExistence?: boolean }) => () =>
  rethrowInquiryRpcError({ message, code: 'x' }, options);

describe('rethrowInquiryRpcError', () => {
  it('maps lookup and authorization failures', () => {
    expect(run('inquiry_not_found')).toThrow(NotFoundError);
    expect(run('not_authorized')).toThrow(AuthorizationError);
    expect(run('review_access_revoked')).toThrow(AuthorizationError);
  });

  it('hideExistence makes not_authorized indistinguishable from not found', () => {
    expect(run('not_authorized', { hideExistence: true })).toThrow(NotFoundError);
  });

  it.each(['inquiry_declined', 'inquiry_already_accepted', 'review_window_expired', 'review_not_available'])(
    'maps state conflict %s to ConflictError',
    (message) => {
      expect(run(message)).toThrow(ConflictError);
    }
  );

  it.each(['assignee_required', 'assignee_not_permitted', 'assignee_not_firm_member', 'assignee_not_lawyer', 'team_not_in_firm', 'invalid_title', 'invalid_note'])(
    'maps input problem %s to ValidationError',
    (message) => {
      expect(run(message)).toThrow(ValidationError);
    }
  );

  it('rethrows anything it does not recognise untouched', () => {
    const original = { message: 'deadlock detected', code: '40P01' };
    expect(() => rethrowInquiryRpcError(original)).toThrowError(expect.objectContaining({ message: 'deadlock detected' }));
    try {
      rethrowInquiryRpcError(original);
    } catch (e) {
      expect(e).toBe(original);
    }
  });
});
