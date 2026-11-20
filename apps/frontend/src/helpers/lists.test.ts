import { describe, expect, it } from 'vitest';

import { sameItems, splitList } from './lists';

describe('splitList', () => {
  it('splits the items of a filter, and has none for a filter that is not set or is empty', () => {
    expect(splitList('a,b')).toEqual(['a', 'b']);
    expect(splitList('')).toEqual([]);
    expect(splitList(undefined)).toEqual([]);
  });
});

describe('sameItems', () => {
  it('is whether both have the same items, in whatever order', () => {
    expect(sameItems(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameItems(['a'], ['a', 'b'])).toBe(false);
    expect(sameItems(['a', 'c'], ['a', 'b'])).toBe(false);
  });
});
