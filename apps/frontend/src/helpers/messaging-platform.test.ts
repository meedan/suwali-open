import { describe, expect, it } from 'vitest';

import { getStatusTone } from './messaging-platform';

describe('getStatusTone', () => {
  it('returns null for empty values', () => {
    expect(getStatusTone(null)).toBeNull();
    expect(getStatusTone(undefined)).toBeNull();
    expect(getStatusTone('')).toBeNull();
    expect(getStatusTone('SOMETHING_UNKNOWN')).toBeNull();
  });

  it('maps WhatsApp uppercase statuses to a tone', () => {
    expect(getStatusTone('GREEN')).toBe('green');
    expect(getStatusTone('CONNECTED')).toBe('green');
    expect(getStatusTone('FLAGGED')).toBe('yellow');
    expect(getStatusTone('RESTRICTED')).toBe('pink');
    expect(getStatusTone('NOT_VERIFIED')).toBe('pink');
  });

  it('maps SMS lowercase registration statuses to the same tones', () => {
    expect(getStatusTone('approved')).toBe('green');
    expect(getStatusTone('unregistered')).toBe('yellow');
    expect(getStatusTone('pending')).toBe('yellow');
    expect(getStatusTone('rejected')).toBe('pink');
    expect(getStatusTone('suspended')).toBe('pink');
  });
});
