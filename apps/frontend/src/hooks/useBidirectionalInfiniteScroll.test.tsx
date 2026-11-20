import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import type { PermalinkPaginationMetadata } from '@customTypes/permalink-pagination-metadata';

import { useBidirectionalInfiniteScroll } from './useBidirectionalInfiniteScroll';

const page = (ids: number[], hasPrevious: boolean, hasNext: boolean) => ({
  data: ids.map(id => ({ id })),
  pagination: {
    type: 'permalink',
    target_record_id: ids[0],
    has_previous: hasPrevious,
    has_next: hasNext,
  } as PermalinkPaginationMetadata,
});

const setup = (queryFn: Parameters<typeof useBidirectionalInfiniteScroll>[0]['queryFn'], fetchLatestInterval?: number) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return renderHook(() => useBidirectionalInfiniteScroll({
    queryKey: ['/items'],
    queryFn,
    fetchLatestInterval,
  }), { wrapper });
};

describe('useBidirectionalInfiniteScroll', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces the loaded items with the window at the requested edge', async () => {
    const queryFn = vi.fn()
      .mockResolvedValueOnce(page([30, 29, 28], false, true))
      .mockResolvedValueOnce(page([3, 2, 1], true, false));
    const { result } = setup(queryFn);
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    await act(() => result.current.jumpToEdge('last'));

    expect(queryFn).toHaveBeenLastCalledWith(null, 20, 'last');
    expect(result.current.items.map(item => item.id)).toEqual([3, 2, 1]);
    expect(result.current.hasPrevious).toBe(true);
    expect(result.current.hasNext).toBe(false);
  });

  it('resolves a jump to the items it loaded, or null when a later jump superseded it', async () => {
    let resolveFirstJump: (value: ReturnType<typeof page>) => void = () => {};
    const queryFn = vi.fn()
      .mockResolvedValueOnce(page([30, 29, 28], true, true))
      .mockReturnValueOnce(new Promise(resolve => { resolveFirstJump = resolve; }))
      .mockResolvedValueOnce(page([3, 2, 1], false, true));
    const { result } = setup(queryFn);
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    let firstJump: Promise<{ id: number }[] | null> = Promise.resolve(null);
    act(() => { firstJump = result.current.jumpToEdge('first'); });
    const lastJumpItems = await act(() => result.current.jumpToEdge('first'));
    resolveFirstJump(page([30, 29, 28], true, true));
    const firstJumpItems = await act(() => firstJump);

    expect(lastJumpItems?.map(item => item.id)).toEqual([3, 2, 1]);
    expect(firstJumpItems).toBeNull();
  });

  it('drops a page that was still loading when the window was replaced by a jump', async () => {
    let resolveStalePage: (value: ReturnType<typeof page>) => void = () => {};
    const queryFn = vi.fn()
      .mockResolvedValueOnce(page([30, 29, 28], true, true))
      .mockReturnValueOnce(new Promise(resolve => { resolveStalePage = resolve; }))
      .mockResolvedValueOnce(page([3, 2, 1], true, false));
    const { result } = setup(queryFn);
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    let stalePage: Promise<void> = Promise.resolve();
    act(() => { stalePage = result.current.fetchPrevious(); });
    await act(() => result.current.jumpToEdge('last'));
    await act(async () => {
      resolveStalePage(page([33, 32, 31], false, true));
      await stalePage;
    });

    expect(result.current.items.map(item => item.id)).toEqual([3, 2, 1]);
    expect(result.current.hasPrevious).toBe(true);
  });

  it('drops a page requested while a jump was pending when it resolves after the jump', async () => {
    let resolveJump: (value: ReturnType<typeof page>) => void = () => {};
    let resolveStalePage: (value: ReturnType<typeof page>) => void = () => {};
    const queryFn = vi.fn()
      .mockResolvedValueOnce(page([30, 29, 28], true, true))
      .mockReturnValueOnce(new Promise(resolve => { resolveJump = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { resolveStalePage = resolve; }));
    const { result } = setup(queryFn);
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    let jump: Promise<unknown> = Promise.resolve();
    let stalePage: Promise<void> = Promise.resolve();
    act(() => { jump = result.current.jumpToEdge('last'); });
    act(() => { stalePage = result.current.fetchPrevious(); });
    await act(async () => {
      resolveJump(page([3, 2, 1], true, false));
      await jump;
    });
    await act(async () => {
      resolveStalePage(page([33, 32, 31], false, true));
      await stalePage;
    });

    expect(result.current.items.map(item => item.id)).toEqual([3, 2, 1]);
    expect(result.current.hasPrevious).toBe(true);
  });

  it('keeps the window of the last jump when an earlier jump resolves after it', async () => {
    let resolveFirstJump: (value: ReturnType<typeof page>) => void = () => {};
    const queryFn = vi.fn()
      .mockResolvedValueOnce(page([30, 29, 28], false, true))
      .mockReturnValueOnce(new Promise(resolve => { resolveFirstJump = resolve; }))
      .mockResolvedValueOnce(page([3, 2, 1], true, false));
    const { result } = setup(queryFn);
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    let firstJump: Promise<unknown> = Promise.resolve();
    act(() => { firstJump = result.current.jumpToEdge('first'); });
    await act(() => result.current.jumpToEdge('last'));
    await act(async () => {
      resolveFirstJump(page([30, 29, 28], false, true));
      await firstJump;
    });

    expect(result.current.items.map(item => item.id)).toEqual([3, 2, 1]);
  });

  it('stops merging the latest items while the window does not reach them', async () => {
    const queryFn = vi.fn()
      .mockResolvedValueOnce(page([30, 29, 28], false, true))
      .mockResolvedValueOnce(page([3, 2, 1], true, false))
      .mockResolvedValue(page([31, 30, 29], false, true));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = setup(queryFn, 3000);
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    await act(() => result.current.jumpToEdge('last'));

    await act(() => vi.advanceTimersByTimeAsync(10000));

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(result.current.items.map(item => item.id)).toEqual([3, 2, 1]);
  });

  it('centers a background refetch on the current item rather than the initial one', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const queryFn = vi.fn().mockResolvedValue(page([30, 29, 28], true, true));
    const { result, rerender } = renderHook(({ currentAroundId }) => useBidirectionalInfiniteScroll({
      queryKey: ['/items'],
      queryFn,
      initialAroundId: 29,
      currentAroundId,
    }), { wrapper, initialProps: { currentAroundId: 29 } });
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    rerender({ currentAroundId: 5 });
    await act(() => queryClient.invalidateQueries({ queryKey: ['/items'] }));

    expect(queryFn).toHaveBeenLastCalledWith(5, 20);
  });
});
