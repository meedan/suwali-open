import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useSyncStatusSettling } from './useSyncStatusSettling';

const setVisibilityState = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

const item = { id: 1 };

const setup = (statuses: (string | undefined)[]) => {
  const fetchStatus = vi.fn();
  statuses.forEach(status => fetchStatus.mockResolvedValueOnce(status));
  fetchStatus.mockResolvedValue('pending');
  const onSettled = vi.fn();
  const hook = renderHook(() => useSyncStatusSettling({ fetchStatus, onSettled }));
  return { fetchStatus, onSettled, ...hook };
};

describe('useSyncStatusSettling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibilityState('visible');
  });

  it('reports the status once the item is no longer pending, then stops looking', async () => {
    const { result, fetchStatus, onSettled } = setup(['pending', 'complete']);

    act(() => result.current('documents-1', item));
    expect(fetchStatus).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(onSettled).toHaveBeenCalledWith(item, 'complete');

    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('settles on an error as well, which the item will not leave without a retry', async () => {
    const { result, onSettled } = setup(['error']);

    act(() => result.current('documents-1', item));
    await act(() => vi.advanceTimersByTimeAsync(3000));

    expect(onSettled).toHaveBeenCalledWith(item, 'error');
  });

  it('waits longer between looks, and gives up after two minutes of a visible tab', async () => {
    const { result, fetchStatus, onSettled } = setup([]);

    act(() => result.current('documents-1', item));
    await act(() => vi.advanceTimersByTimeAsync(3000 + 5000 + 8000));
    expect(fetchStatus).toHaveBeenCalledTimes(3);

    await act(() => vi.advanceTimersByTimeAsync(10 * 60 * 1000));
    const calls = fetchStatus.mock.calls.length;
    expect(calls).toBeLessThan(20);

    await act(() => vi.advanceTimersByTimeAsync(10 * 60 * 1000));
    expect(fetchStatus).toHaveBeenCalledTimes(calls);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('does not look while the tab is hidden, and carries on when it is shown', async () => {
    const { result, fetchStatus, onSettled } = setup(['complete']);

    act(() => setVisibilityState('hidden'));
    act(() => result.current('documents-1', item));
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(fetchStatus).not.toHaveBeenCalled();

    act(() => setVisibilityState('visible'));
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(onSettled).toHaveBeenCalledWith(item, 'complete');
  });

  it('keeps looking when the status cannot be told', async () => {
    const { result, onSettled } = setup([undefined, 'complete']);

    act(() => result.current('documents-1', item));
    await act(() => vi.advanceTimersByTimeAsync(3000 + 5000));

    expect(onSettled).toHaveBeenCalledWith(item, 'complete');
  });

  it('watches an item once however many times it is watched, and each item on its own', async () => {
    const { result, fetchStatus } = setup([]);

    act(() => {
      result.current('documents-1', item);
      result.current('documents-1', item);
      result.current('documents-2', { id: 2 });
    });
    await act(() => vi.advanceTimersByTimeAsync(3000));

    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('lets go of a look still under way when the item is watched again', async () => {
    const fetchStatus = vi.fn();
    let resolveFirst: (value: string) => void = () => {};
    fetchStatus.mockReturnValueOnce(new Promise<string>(resolve => { resolveFirst = resolve; }));
    fetchStatus.mockResolvedValue('pending');
    const onSettled = vi.fn();
    const { result } = renderHook(() => useSyncStatusSettling({ fetchStatus, onSettled }));

    act(() => result.current('documents-1', item));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    act(() => result.current('documents-1', item));
    await act(async () => resolveFirst('complete'));
    expect(onSettled).not.toHaveBeenCalled();

    // Only the second watch carries on: one look per wait, not two chains
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it('stops looking when it is unmounted', async () => {
    const { result, fetchStatus, unmount } = setup([]);

    act(() => result.current('documents-1', item));
    unmount();
    await vi.advanceTimersByTimeAsync(60000);

    expect(fetchStatus).not.toHaveBeenCalled();
  });
});
