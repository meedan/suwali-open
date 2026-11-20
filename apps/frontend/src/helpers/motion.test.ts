import { afterEach, describe, expect, it, vi } from 'vitest';

import { prefersReducedMotion } from './motion';

const stubMatchMedia = (matches: boolean) => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches })));
};

describe('prefersReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true when the system asks for reduced motion', () => {
    stubMatchMedia(true);

    expect(prefersReducedMotion()).toBe(true);
  });

  it('is false otherwise', () => {
    stubMatchMedia(false);

    expect(prefersReducedMotion()).toBe(false);
  });
});
