import { useEffect, useRef } from 'react';
import { type InfiniteData, useInfiniteQuery, type UseInfiniteQueryOptions } from '@tanstack/react-query';

import type { PaginationMetadata } from '@customTypes/pagination-metadata';

import { DEFAULT_QUERY_STALE_TIME } from '@constants/App';

type PaginatedResponse<T> = {
  data: T[];
  pagination: PaginationMetadata;
};

type UseInfiniteScrollQueryOptions<T> = {
  queryKey: (string | number)[];
  queryFn: (page: number, perPage: number) => Promise<PaginatedResponse<T>>;
  perPage?: number;
  enabled?: boolean;
  staleTime?: number;
  // Keep showing the current items while a new key (e.g. a sort or filter) loads, instead of going back to pending
  keepPreviousData?: boolean;
};

export function useInfiniteScrollQuery<T>({
  queryKey,
  queryFn,
  perPage = 100,
  enabled = true,
  staleTime = DEFAULT_QUERY_STALE_TIME,
  keepPreviousData = false,
}: UseInfiniteScrollQueryOptions<T>) {
  const observerTarget = useRef<HTMLSpanElement>(null);

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isError,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam = 1 }) => queryFn(pageParam, perPage),
    getNextPageParam: (lastPage) => {
      return lastPage?.pagination.next_page || undefined;
    },
    initialPageParam: 1,
    enabled,
    staleTime,
    // Never carried across lists or hubs, only between keys of the same list
    placeholderData: (previousData: InfiniteData<PaginatedResponse<T>> | undefined, previousQuery?: { queryKey: readonly unknown[] }) =>
      keepPreviousData && previousQuery?.queryKey[0] === queryKey[0] ? previousData : undefined,
  } as UseInfiniteQueryOptions<PaginatedResponse<T>, Error, InfiniteData<PaginatedResponse<T>>, (string | number)[], number>);

  // Set up intersection observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Flatten all pages into a single array
  const items = data?.pages.flatMap((page: PaginatedResponse<T>) => page.data) ?? [];

  // Get pagination metadata from the first page
  const pagination = data?.pages[0]?.pagination;

  return {
    items,
    pagination,
    error,
    isPending,
    isError,
    hasNextPage,
    isFetchingNextPage,
    observerTarget,
    fetchNextPage,
  };
};
