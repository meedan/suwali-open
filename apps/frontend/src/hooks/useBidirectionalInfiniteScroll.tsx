import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

import type { PermalinkPaginationMetadata } from '@customTypes/permalink-pagination-metadata';

import { DEFAULT_QUERY_STALE_TIME } from '@constants/App';

import { usePageVisibility } from '@hooks/usePageVisibility';

type PaginatedResponse<T> = {
  data: T[];
  pagination: PermalinkPaginationMetadata;
};

// Which end of the sort order to start from when there is no aroundId
type PaginationAnchor = 'first' | 'last';

type UseBidirectionalInfiniteScrollOptions<T> = {
  queryKey: (string | number | undefined)[];
  queryFn: (aroundId: number | null, windowSize: number, anchor?: PaginationAnchor) => Promise<PaginatedResponse<T>>;
  initialAroundId?: number | null;
  // Item a background refetch should center on; without it a refetch reloads the initial window and drops the selection
  currentAroundId?: number | null;
  windowSize?: number;
  enabled?: boolean;
  staleTime?: number;
  fetchLatestInterval?: number;
  refetchInterval?: number;
  refetchOnWindowFocus?: boolean;
};

export function useBidirectionalInfiniteScroll<T extends { id: number }>({
  queryKey,
  queryFn,
  initialAroundId = null,
  currentAroundId = null,
  windowSize = 20,
  enabled = true,
  staleTime = DEFAULT_QUERY_STALE_TIME,
  fetchLatestInterval,
  refetchInterval,
  refetchOnWindowFocus = true,
}: UseBidirectionalInfiniteScrollOptions<T>) {
  const queryClient = useQueryClient();

  const [hasPrevious, setHasPrevious] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [targetRecordId, setTargetRecordId] = useState<number | null>(initialAroundId);
  const [lastLoadDirection, setLastLoadDirection] = useState<'previous' | 'next' | null>(null);
  const [paginationMetadata, setPaginationMetadata] = useState<PermalinkPaginationMetadata | null>(null);
  // Bumped when a jump starts and when it lands, so responses requested for the previous window are dropped
  const windowGenerationRef = useRef(0);
  // A ref so the query key, and with it the cache entry, stays stable while the selection changes
  const currentAroundIdRef = useRef(currentAroundId);
  currentAroundIdRef.current = currentAroundId;

  /**
   * Stable query key with params
   */
  const queryKeyWithParams = useMemo(
    () => [
      ...queryKey,
      `aroundId:${initialAroundId}`,
      `windowSize:${windowSize}`,
    ],
    [queryKey, initialAroundId, windowSize]
  );

  /**
   * Primary query
   */
  const {
    data,
    error,
    isPending: queryIsPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeyWithParams,
    queryFn: () => queryFn(currentAroundIdRef.current ?? initialAroundId, windowSize),
    enabled,
    staleTime,
    refetchInterval,
    refetchOnWindowFocus,
  } as UseQueryOptions<PaginatedResponse<T>, Error>);

  /**
   * Source of truth — from cache
   */
  const items = useMemo(() => data?.data ?? [], [data]);

  /**
   * Sync pagination metadata from cache
   */
  useEffect(() => {
    if (data || error) {
      setInitialLoading(false);
    }

    if (data?.pagination) {
      setHasPrevious(data.pagination.has_previous);
      setHasNext(data.pagination.has_next);
      setTargetRecordId(data.pagination.target_record_id);
      setPaginationMetadata(data.pagination);
    }
  }, [data, error]);

  /**
   * Merge helper — deterministic and deduplicated
   */
  const mergeItems = useCallback(
    (
      existing: T[],
      incoming: T[],
      direction: 'previous' | 'next'
    ) => {
      const existingIds = new Set(existing.map(i => i.id));

      const filtered = incoming.filter(
        i => !existingIds.has(i.id)
      );

      return direction === 'previous'
        ? [...filtered, ...existing]
        : [...existing, ...filtered];
    },
    []
  );

  // Fetch previous (older) items
  const fetchPrevious = useCallback(async () => {
    if (!hasPrevious || isLoadingPrevious || items.length === 0) return;

    setIsLoadingPrevious(true);
    setLastLoadDirection('previous');

    try {
      const firstItemId = items[0].id;
      const generation = windowGenerationRef.current;
      const response = await queryFn(firstItemId, windowSize);
      if (generation !== windowGenerationRef.current) return;

      // Merge new items with existing ones, removing the duplicate anchor item
      queryClient.setQueryData<PaginatedResponse<T>>(queryKeyWithParams, old => {
        if (!old) return response;

        return {
          ...old,
          data: mergeItems(
            old.data,
            response.data,
            'previous'
          ),
          pagination: {
            ...old.pagination,
            has_previous: response.pagination.has_previous,
          },
        };
      });

      setHasPrevious(response.pagination.has_previous);
    } catch (err) {
      console.error('Error fetching previous items:', err);
    } finally {
      setIsLoadingPrevious(false);
    }
  }, [hasPrevious, isLoadingPrevious, items, queryFn, windowSize, queryClient, queryKeyWithParams, mergeItems]);

  // Fetch next (newer) items
  const fetchNext = useCallback(async () => {
    if (!hasNext || isLoadingNext || items.length === 0) return;

    setIsLoadingNext(true);
    setLastLoadDirection('next');

    try {
      const lastItemId = items[items.length - 1].id;
      const generation = windowGenerationRef.current;
      const response = await queryFn(lastItemId, windowSize);
      if (generation !== windowGenerationRef.current) return;

      // Merge new items with existing ones, removing the duplicate anchor item
      queryClient.setQueryData<PaginatedResponse<T>>(queryKeyWithParams, old => {
        if (!old) return response;

        return {
          ...old,
          data: mergeItems(
            old.data,
            response.data,
            'next'
          ),
          pagination: {
            ...old.pagination,
            has_next: response.pagination.has_next,
          },
        };
      });

      setHasNext(response.pagination.has_next);
    } catch (err) {
      console.error('Error fetching next items:', err);
    } finally {
      setIsLoadingNext(false);
    }
  }, [hasNext, isLoadingNext, items, queryFn, windowSize, queryClient, queryKeyWithParams, mergeItems]);

  // Prepend/append after create
  const addItem = useCallback((newItem: T, direction: 'next' | 'previous' = 'previous') => {
    queryClient.setQueryData<PaginatedResponse<T>>(queryKeyWithParams, old => {
      if (!old) {
        return {
          data: [newItem],
          pagination: {
            has_previous: false,
            has_next: false,
            target_record_id: newItem.id,
          },
        } as PaginatedResponse<T>;
      }

      return {
        ...old,
        data: mergeItems(
          old.data,
          [newItem],
          direction
        ),
      } as PaginatedResponse<T>;

    });
  }, [mergeItems, queryClient, queryKeyWithParams]);

  // Refetch first page and append to existing items (for auto-refresh use case)
  const fetchLatest = useCallback(async () => {
    // The first page isn't contiguous with a window that doesn't reach it, so merging would leave a gap
    if (hasPrevious) return;

    try {
      const generation = windowGenerationRef.current;
      const response = await queryFn(null, windowSize);
      if (generation !== windowGenerationRef.current) return;

      // Merge new items with existing ones, removing duplicates
      queryClient.setQueryData<PaginatedResponse<T>>(queryKeyWithParams, old => {
        if (!old) return response;

        return {
          ...old,
          data: mergeItems(
            old.data,
            response.data,
            'previous'
          ),
          pagination: {
            ...old.pagination,
            has_previous: response.pagination.has_previous,
          },
        };
      });

      setHasPrevious(response.pagination.has_previous);
    } catch (err) {
      console.error('Error fetching latest items:', err);
    }
  }, [hasPrevious, queryFn, windowSize, queryClient, queryKeyWithParams, mergeItems]);

  const isPageVisible = usePageVisibility();
  const wasPageVisible = useRef(isPageVisible);
  const lastFetchLatestAt = useRef(0);

  const triggerFetchLatest = useCallback(() => {
    lastFetchLatestAt.current = Date.now();
    fetchLatest();
  }, [fetchLatest]);

  useEffect(() => {
    if (!fetchLatestInterval || !isPageVisible) {
      wasPageVisible.current = isPageVisible;
      return;
    }

    // Catch up immediately when the tab regains focus, instead of waiting for the next tick.
    // Skip if we already fetched recently, so rapid tab switching can't fetch more often
    // than the configured interval.
    if (!wasPageVisible.current && Date.now() - lastFetchLatestAt.current >= fetchLatestInterval) {
      triggerFetchLatest();
    }
    wasPageVisible.current = true;

    const interval = setInterval(triggerFetchLatest, fetchLatestInterval);

    return () => clearInterval(interval);
  }, [triggerFetchLatest, fetchLatestInterval, isPageVisible]);

  // Refetch with a fresh window centered on a specific item (for after creating/updating an item)
  const refetchAroundId = useCallback(async (itemId?: number) => {
    if (items.length === 0) {
      await refetch();
      return;
    }

    const anchorId = itemId ?? items[Math.floor(items.length / 2)].id;

    try {
      const response = await queryFn(anchorId, windowSize);
      queryClient.setQueryData<PaginatedResponse<T>>(queryKeyWithParams, response);
      setHasPrevious(response.pagination.has_previous);
      setHasNext(response.pagination.has_next);
      setTargetRecordId(response.pagination.target_record_id);
      setPaginationMetadata(response.pagination);
      setLastLoadDirection(null);
      setIsLoadingPrevious(false);
      setIsLoadingNext(false);
    } catch (err) {
      console.error('Error refetching around ID:', err);
    }
  }, [items, queryFn, refetch, windowSize, queryClient, queryKeyWithParams]);

  // Replace the loaded items with the window at one end of the list, without loading what lies between;
  // resolves to the new items, or null when a later jump superseded it or the request failed
  const jumpToEdge = useCallback(async (anchor: PaginationAnchor): Promise<T[] | null> => {
    try {
      const generation = ++windowGenerationRef.current;
      const response = await queryFn(null, windowSize, anchor);
      if (generation !== windowGenerationRef.current) return null;
      // Bump again so pages requested from the old window while this jump was pending are dropped too
      windowGenerationRef.current++;
      queryClient.setQueryData<PaginatedResponse<T>>(queryKeyWithParams, response);
      setHasPrevious(response.pagination.has_previous);
      setHasNext(response.pagination.has_next);
      setTargetRecordId(response.pagination.target_record_id);
      setPaginationMetadata(response.pagination);
      setLastLoadDirection(null);
      return response.data;
    } catch (err) {
      console.error('Error jumping to edge:', err);
      return null;
    }
  }, [queryFn, windowSize, queryClient, queryKeyWithParams]);

  return {
    items,
    targetRecordId,
    error,
    // Combine initialLoading with queryIsPending
    isPending: initialLoading || queryIsPending,
    isError,
    hasPrevious,
    hasNext,
    isLoadingPrevious,
    isLoadingNext,
    lastLoadDirection,
    pagination: paginationMetadata,
    addItem,
    fetchPrevious,
    fetchNext,
    refetch,
    refetchAroundId,
    jumpToEdge,
  };
}
