import { describe, expect, it } from 'vitest';

import {
  formatLimit,
  getActivityStatus,
  getDocumentActivityStatus,
  getEditorsStatus,
  getStatusIcon,
  getTrialStatus,
  toDateInputValue,
} from './platform-admin';

describe('toDateInputValue', () => {
  it('extracts the UTC date from a midnight UTC datetime string', () => {
    expect(toDateInputValue('2026-04-22T00:00:00.000Z')).toBe('2026-04-22');
  });

  it('does not shift the date for timezones behind UTC', () => {
    // Midnight UTC is e.g. 8pm the day before in UTC-4 — must still return the UTC date
    expect(toDateInputValue('2026-04-22T00:00:00Z')).toBe('2026-04-22');
  });

  it('pads single-digit months and days', () => {
    expect(toDateInputValue('2026-01-05T00:00:00Z')).toBe('2026-01-05');
  });
});

describe('formatLimit', () => {
  it('returns count/max when max is set', () => {
    expect(formatLimit(5, 10)).toBe('5 / 10');
  });

  it('returns just count when max is null', () => {
    expect(formatLimit(5, null)).toBe('5');
  });

  it('returns count/unlimitedLabel when max is null and unlimitedLabel is provided', () => {
    expect(formatLimit(5, null, 'Unlimited')).toBe('5 / Unlimited');
  });

  it('returns count with default value when max is null and unlimitedLabel is not provided', () => {
    expect(formatLimit(5, null)).toBe('5');
  });

  it('returns count with default value when count is not provided', () => {
    expect(formatLimit(undefined, 10)).toBe('0 / 10');
  });
});

describe('getTrialStatus', () => {
  it('returns pink when trial is expired', () => {
    expect(getTrialStatus(true, null)).toBe('pink');
  });

  it('returns null when trial is not active and has no end date', () => {
    expect(getTrialStatus(false, null)).toBeNull();
  });

  it('returns green when more than 14 days remaining', () => {
    const endsAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    expect(getTrialStatus(false, endsAt)).toBe('green');
  });

  it('returns yellow when 7–14 days remaining', () => {
    const endsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(getTrialStatus(false, endsAt)).toBe('yellow');
  });

  it('returns pink when fewer than 7 days remaining', () => {
    const endsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(getTrialStatus(false, endsAt)).toBe('pink');
  });
});

describe('getDocumentActivityStatus', () => {
  it('returns pink when no date is provided', () => {
    expect(getDocumentActivityStatus(null)).toBe('pink');
  });

  it('returns green when activity was within the last 7 days', () => {
    const lastAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(getDocumentActivityStatus(lastAt)).toBe('green');
  });

  it('returns yellow when activity was 7–14 days ago', () => {
    const lastAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(getDocumentActivityStatus(lastAt)).toBe('yellow');
  });

  it('returns pink when activity was more than 14 days ago', () => {
    const lastAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    expect(getDocumentActivityStatus(lastAt)).toBe('pink');
  });
});

describe('getActivityStatus', () => {
  it('returns pink when no date is provided', () => {
    expect(getActivityStatus(null)).toBe('pink');
  });

  it('returns green when activity was within the last 24 hours', () => {
    const lastAt = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    expect(getActivityStatus(lastAt)).toBe('green');
  });

  it('returns yellow when activity was 1–7 days ago', () => {
    const lastAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(getActivityStatus(lastAt)).toBe('yellow');
  });

  it('returns pink when activity was more than 7 days ago', () => {
    const lastAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(getActivityStatus(lastAt)).toBe('pink');
  });
});

describe('getEditorsStatus', () => {
  it('returns pink when there are unapproved editors', () => {
    expect(getEditorsStatus(2, 0)).toBe('pink');
  });

  it('returns yellow when there are unconfirmed editors but none unapproved', () => {
    expect(getEditorsStatus(0, 3)).toBe('yellow');
  });

  it('returns green when all editors are confirmed and approved', () => {
    expect(getEditorsStatus(0, 0)).toBe('green');
  });
});

describe('getStatusIcon', () => {
  it('returns check_filled for green', () => {
    expect(getStatusIcon('green')).toBe('check_filled');
  });

  it('returns countdown_filled for yellow', () => {
    expect(getStatusIcon('yellow')).toBe('countdown_filled');
  });

  it('returns error_filled for pink', () => {
    expect(getStatusIcon('pink')).toBe('error_filled');
  });

});
