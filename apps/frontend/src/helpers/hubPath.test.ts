import { describe, expect, it } from 'vitest';

import {
  extractHubIdFromPath,
  hasInvalidHubPrefix,
  hubPath,
  isValidHubId,
  matchesHubPath,
  startsWithHubPath,
  stripHubPrefix,
} from './hubPath';

describe('hubPath', () => {
  it('prepends /hub/:hubId when hubId is present', () => {
    expect(hubPath('/dashboard', 42)).toBe('/hub/42/dashboard');
  });

  it('works with string hubId', () => {
    expect(hubPath('/dashboard', '42')).toBe('/hub/42/dashboard');
  });

  it('handles nested paths', () => {
    expect(hubPath('/notebooks/5/items/3', 42)).toBe('/hub/42/notebooks/5/items/3');
  });

  it('returns path unchanged when hubId is null', () => {
    expect(hubPath('/dashboard', null)).toBe('/dashboard');
  });

  it('is idempotent — does not double-prefix', () => {
    expect(hubPath('/hub/42/dashboard', 42)).toBe('/hub/42/dashboard');
  });

  it('replaces hub ID when a different one is provided', () => {
    expect(hubPath('/hub/99/dashboard', 42)).toBe('/hub/42/dashboard');
  });

  it('handles root path', () => {
    expect(hubPath('/', 42)).toBe('/hub/42/');
  });
});

describe('matchesHubPath', () => {
  it('matches path without prefix', () => {
    expect(matchesHubPath('/dashboard', '/dashboard')).toBe(true);
  });

  it('matches path with hub prefix', () => {
    expect(matchesHubPath('/hub/42/dashboard', '/dashboard')).toBe(true);
  });

  it('does not match different paths', () => {
    expect(matchesHubPath('/hub/42/notebooks', '/dashboard')).toBe(false);
  });

  it('does not match partial paths', () => {
    expect(matchesHubPath('/dashboard/extra', '/dashboard')).toBe(false);
  });
});

describe('startsWithHubPath', () => {
  it('matches prefix without hub prefix', () => {
    expect(startsWithHubPath('/conversations/5', '/conversations/')).toBe(true);
  });

  it('matches prefix with hub prefix', () => {
    expect(startsWithHubPath('/hub/42/conversations/5', '/conversations/')).toBe(true);
  });

  it('does not match different prefix', () => {
    expect(startsWithHubPath('/hub/42/notebooks/5', '/conversations/')).toBe(false);
  });

  it('matches exact path as prefix', () => {
    expect(startsWithHubPath('/hub/42/dashboard', '/dashboard')).toBe(true);
  });
});

describe('stripHubPrefix', () => {
  it('strips /hub/:id prefix', () => {
    expect(stripHubPrefix('/hub/42/dashboard')).toBe('/dashboard');
  });

  it('returns path unchanged when no prefix', () => {
    expect(stripHubPrefix('/dashboard')).toBe('/dashboard');
  });

  it('handles hub prefix with trailing slash only', () => {
    expect(stripHubPrefix('/hub/42/')).toBe('/');
  });

  it('handles nested paths', () => {
    expect(stripHubPrefix('/hub/1/notebooks/5/items/3')).toBe('/notebooks/5/items/3');
  });

  it('does not strip non-hub paths starting with /hub', () => {
    expect(stripHubPrefix('/hub/join')).toBe('/hub/join');
  });

  it('does not strip /hub/setup', () => {
    expect(stripHubPrefix('/hub/setup')).toBe('/hub/setup');
  });

  it('does not strip /hub/new', () => {
    expect(stripHubPrefix('/hub/new')).toBe('/hub/new');
  });
});

describe('extractHubIdFromPath', () => {
  it('extracts hub ID from prefixed path', () => {
    expect(extractHubIdFromPath('/hub/42/dashboard')).toBe(42);
  });

  it('returns null when no hub prefix', () => {
    expect(extractHubIdFromPath('/dashboard')).toBeNull();
  });

  it('returns null for non-numeric hub segment', () => {
    expect(extractHubIdFromPath('/hub/join')).toBeNull();
  });

  it('returns null for /hub/new', () => {
    expect(extractHubIdFromPath('/hub/new')).toBeNull();
  });

  it('returns null for /hub/setup', () => {
    expect(extractHubIdFromPath('/hub/setup')).toBeNull();
  });

  it('handles large hub IDs', () => {
    expect(extractHubIdFromPath('/hub/999999/notebooks')).toBe(999999);
  });
});

describe('isValidHubId', () => {
  it('accepts positive integer ids', () => {
    expect(isValidHubId('42')).toBe(true);
  });

  it.each(['sfsdfsd', '42abc', '4.2', '0', '007', '-1', '', undefined])('rejects %s', (id) => {
    expect(isValidHubId(id)).toBe(false);
  });
});

describe('hasInvalidHubPrefix', () => {
  it.each(['/hub/abc', '/hub/abc/dashboard', '/hub/0', '/hub/0/dashboard', '/hub/007/plans'])('is true for %s', (path) => {
    expect(hasInvalidHubPrefix(path)).toBe(true);
  });

  it.each(['/hub/42', '/hub/42/dashboard', '/hub/join', '/hub/setup', '/dashboard', '/asdf', '/hub'])('is false for %s', (path) => {
    expect(hasInvalidHubPrefix(path)).toBe(false);
  });
});

describe('extractHubIdFromPath with ids that are not hub ids', () => {
  it.each(['/hub/0/dashboard', '/hub/007/dashboard', '/hub/abc/dashboard'])('returns null for %s', (path) => {
    expect(extractHubIdFromPath(path)).toBeNull();
  });
});
