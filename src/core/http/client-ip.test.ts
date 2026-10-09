// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getClientIp } from './client-ip';

describe('getClientIp', () => {
  it('prefers platform headers and takes only the first XFF hop', () => {
    expect(getClientIp(new Headers({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' }))).toBe('203.0.113.1');
    expect(getClientIp(new Headers({ 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '1.1.1.1' }))).toBe('198.51.100.2');
  });
  it('ignores malformed / junk values and returns null when none are valid', () => {
    expect(getClientIp(new Headers({ 'x-forwarded-for': "'; drop table--" }))).toBeNull();
    expect(getClientIp(new Headers({ 'x-real-ip': 'not-an-ip' }))).toBeNull();
    expect(getClientIp(new Headers())).toBeNull();
  });
  it('accepts IPv6', () => {
    expect(getClientIp(new Headers({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
  });
});
