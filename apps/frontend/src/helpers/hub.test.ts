import { describe, expect, it } from 'vitest';

import { getCurrentSetupStep } from './hub';

describe('getCurrentSetupStep', () => {
  it('returns 1 when no hub exists yet, regardless of task state', () => {
    expect(getCurrentSetupStep(false, false, false)).toBe(1);
    expect(getCurrentSetupStep(false, true, true)).toBe(1);
  });

  it('returns 2 when a hub exists but no source has been created', () => {
    expect(getCurrentSetupStep(true, false, false)).toBe(2);
  });

  it('returns 2 when a source has been created but not yet synced', () => {
    expect(getCurrentSetupStep(true, true, false)).toBe(2);
  });

  it('returns 3 once a hub exists and content has been created and synced', () => {
    expect(getCurrentSetupStep(true, true, true)).toBe(3);
  });
});
