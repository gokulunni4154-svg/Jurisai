import { describe, expect, it, vi } from 'vitest';

import { handleApiError } from '@/core/errors/error-handler';

describe('handleApiError — Next.js dynamic-usage signal', () => {
  it('rethrows the DYNAMIC_SERVER_USAGE bailout instead of converting it to a 500', () => {
    const bailout = Object.assign(new Error('Dynamic server usage'), {
      digest: 'DYNAMIC_SERVER_USAGE',
    });

    expect(() => handleApiError(bailout)).toThrow(bailout);
  });

  it('still maps an ordinary unexpected error to a 500 JSON response', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = handleApiError(new Error('boom'));

    expect(response.status).toBe(500);
    spy.mockRestore();
  });
});
