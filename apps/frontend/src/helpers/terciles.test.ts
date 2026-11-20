import { describe, expect, it } from 'vitest';

import { inTercile, tercileBand, tercileBounds } from './terciles';

describe('terciles', () => {
  const bounds = tercileBounds(6);

  it('splits the axis into three equal ranges', () => {
    expect(bounds).toEqual({ lower: 2, upper: 4 });
    expect(tercileBand('bottom', bounds, 6)).toEqual([0, 2]);
    expect(tercileBand('middle', bounds, 6)).toEqual([2, 4]);
    expect(tercileBand('top', bounds, 6)).toEqual([4, 6]);
  });

  it('classifies a value against the bounds, putting boundaries in the lower band', () => {
    expect(inTercile(1, 'bottom', bounds)).toBe(true);
    expect(inTercile(3, 'middle', bounds)).toBe(true);
    expect(inTercile(6, 'top', bounds)).toBe(true);
    expect(inTercile(2, 'bottom', bounds)).toBe(true);
    expect(inTercile(2, 'middle', bounds)).toBe(false);
  });
});
