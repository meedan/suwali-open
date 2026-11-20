import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatElapsedTime, isOlderThanHours } from './dates';

describe('isOlderThanHours', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when the date is older than the given number of hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));

    const date = new Date('2026-01-01T09:59:59Z');

    expect(isOlderThanHours(date, 2)).toBe(true);
  });

  it('returns false when the date is exactly the given number of hours old', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));

    const date = new Date('2026-01-01T10:00:00Z');

    expect(isOlderThanHours(date, 2)).toBe(false);
  });

  it('returns false when the date is newer than the given number of hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));

    const date = new Date('2026-01-01T10:30:00Z');

    expect(isOlderThanHours(date, 2)).toBe(false);
  });
});

describe('formatElapsedTime', () => {
  it('formats elapsed time correctly for hours, minutes, and seconds', () => {
    const locale = 'en';
    const seconds = 3661; // 1 hour, 1 minute, and 1 second
    const result = formatElapsedTime(locale, seconds);
    expect(result).toBe('1 hr, 1 min, 1 sec');
  });

  it('formats elapsed time correctly localized for hours, minutes, and seconds', () => {
    const locale = 'pt';
    const seconds = 72; // 1 minute, and 12 seconds
    const result = formatElapsedTime(locale, seconds);
    expect(result).toBe('1 min e 12 s');
  });
});
