import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { usePageVisibility } from '@hooks/usePageVisibility';

const setVisibilityState = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('usePageVisibility', () => {
  afterEach(() => {
    setVisibilityState('visible');
  });

  it('reflects the initial document visibility state', () => {
    setVisibilityState('hidden');

    const { result } = renderHook(() => usePageVisibility());

    expect(result.current).toBe(false);
  });

  it('updates when the tab is hidden and shown again', () => {
    const { result } = renderHook(() => usePageVisibility());

    expect(result.current).toBe(true);

    act(() => {
      setVisibilityState('hidden');
    });
    expect(result.current).toBe(false);

    act(() => {
      setVisibilityState('visible');
    });
    expect(result.current).toBe(true);
  });
});
