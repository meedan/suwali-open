import { describe, expect, it } from 'vitest';

import { isBsuid } from './conversation';

describe('isBsuid', () => {
  it('returns true for a standard BSUID', () => {
    expect(isBsuid('US.1349120865530274')).toBe(true);
  });

  it('returns true for an enterprise (parent) BSUID', () => {
    expect(isBsuid('US.ENT.1349120865530274')).toBe(true);
  });

  it('returns false for a phone number', () => {
    expect(isBsuid('5511999999999')).toBe(false);
  });

  it('returns false for a phone number with plus sign', () => {
    expect(isBsuid('+5511999999999')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isBsuid('')).toBe(false);
  });
});
