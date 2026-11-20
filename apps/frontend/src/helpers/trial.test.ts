import { describe, expect, it } from 'vitest';

import { buildHub } from '@root/test/fixtures/hub';

import { getDaysRemaining, getTrialRemainingPercent, isRestricted, isTrial } from './trial';

const baseHub = buildHub();

describe('isRestricted', () => {
  it('returns true for free plan', () => {
    expect(isRestricted({ ...baseHub, plan: 'free' })).toBe(true);
  });

  it('returns false for enterprise plan', () => {
    expect(isRestricted({ ...baseHub, plan: 'enterprise' })).toBe(false);
  });

  it('returns false for free_unrestricted plan', () => {
    expect(isRestricted({ ...baseHub, plan: 'free_unrestricted' })).toBe(false);
  });
});

describe('isTrial', () => {
  it('returns false for enterprise plan', () => {
    expect(isTrial({ ...baseHub, plan: 'enterprise' })).toBe(false);
  });
  it('returns true for free plan', () => {
    expect(isTrial({ ...baseHub, plan: 'free' })).toBe(true);
  });
  it('returns true for free_unrestricted plan', () => {
    expect(isTrial({ ...baseHub, plan: 'free_unrestricted' })).toBe(true);
  });
});

describe('getDaysRemaining', () => {
  it('returns null when no date is provided', () => {
    expect(getDaysRemaining(undefined)).toBeNull();
  });
  it('returns 0 for a date in the past', () => {
    expect(getDaysRemaining('2020-01-01T00:00:00Z')).toBe(0);
  });
  it('returns the correct number of days for a future date', () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(getDaysRemaining(future)).toBe(5);
  });
  it('rounds a partial day up', () => {
    const almostTwoDays = new Date(Date.now() + 1.5 * 24 * 60 * 60 * 1000).toISOString();
    expect(getDaysRemaining(almostTwoDays)).toBe(2);
  });
});

describe('getTrialRemainingPercent', () => {
  it('returns 0 when trial dates are missing', () => {
    expect(getTrialRemainingPercent(baseHub)).toBe(0);
  });
  it('returns approximately 50 when half the trial has elapsed', () => {
    const start = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
    const percent = getTrialRemainingPercent({ ...baseHub, trial_started_at: start, trial_ends_at: end });
    expect(percent).toBeCloseTo(50, 0);
  });
  it('clamps to 0 for an expired trial', () => {
    const start = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(getTrialRemainingPercent({ ...baseHub, trial_started_at: start, trial_ends_at: end })).toBe(0);
  });
  it('clamps to 100 when trial has not started yet', () => {
    const start = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(getTrialRemainingPercent({ ...baseHub, trial_started_at: start, trial_ends_at: end })).toBe(100);
  });
});
