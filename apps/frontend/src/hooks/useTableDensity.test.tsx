import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useTableDensity } from './useTableDensity';

describe('useTableDensity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to compact', () => {
    const { result } = renderHook(() => useTableDensity());
    expect(result.current[0]).toBe('compact');
  });

  it('remembers the choice for the next visit', () => {
    const { result, unmount } = renderHook(() => useTableDensity());
    act(() => result.current[1]('comfortable'));
    expect(result.current[0]).toBe('comfortable');
    unmount();

    const { result: next } = renderHook(() => useTableDensity());
    expect(next.current[0]).toBe('comfortable');
  });

  it('ignores a stored value it does not recognise', () => {
    localStorage.setItem('suwali-table-density', 'huge');
    const { result } = renderHook(() => useTableDensity());
    expect(result.current[0]).toBe('compact');
  });

  it('still works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });

    const { result } = renderHook(() => useTableDensity());
    expect(result.current[0]).toBe('compact');
    act(() => result.current[1]('comfortable'));
    expect(result.current[0]).toBe('comfortable');
  });
});
