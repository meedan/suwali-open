import { afterEach, describe, expect, it, vi } from 'vitest';

import { iconUrl, prefetchIcon } from './icons';

describe('prefetchIcon', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the same URL that <Icon> draws from, so the cached copy is reused', () => {
    const images: { src: string }[] = [];
    vi.stubGlobal('Image', class {
      src = '';
      constructor() { images.push(this); }
    });

    prefetchIcon('error');

    expect(images.map((image) => image.src)).toEqual([iconUrl('error')]);
    expect(iconUrl('error')).toBe('/assets/icons/error.svg?');
  });
});
