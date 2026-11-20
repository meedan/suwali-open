import { useEffect, useRef } from 'react';

type QueryObject<T> = {
  items: T[];
  targetRecordId: number | null;
  isLoadingPrevious: boolean;
  isLoadingNext: boolean;
  lastLoadDirection: 'previous' | 'next' | null;
  hasPrevious: boolean;
  hasNext: boolean;
  fetchPrevious: () => void;
  fetchNext: () => void;
};

type UsePaginatedListScrollOptions<T> = {
  /**
   * The ID of the scrollable container element
   */
  containerElementId?: string;
  /**
   * The prefix used for item element IDs (e.g., "notebook", "conversation")
   * Item IDs will be generated as `${itemIdPrefix}-${item.id}`
   */
  itemIdPrefix?: string;
  /**
   * The query object from useBidirectionalInfiniteScroll
   */
  query: QueryObject<T>;
  /**
   * Optional additional condition that must be true before scrolling
   * Useful for waiting for view to settle or other async operations
   */
  additionalScrollCondition?: boolean;

  /**
   * Use true if div is flex-direction: column-reverse (scrolling upwards)
   */
  reverse?: boolean;
};

/**
 * Custom hook to manage scroll behavior for paginated lists
 *
 * Handles:
 * - Preserving scroll position when loading new items (pagination)
 * - Scrolling to a target item when specified
 * - Resetting scroll state when target changes
 * - Managing intersection observers for bidirectional infinite scroll
 */
export function usePaginatedListScroll<T extends { id: number }>({
  containerElementId,
  itemIdPrefix,
  query,
  additionalScrollCondition = true,
  reverse,
}: UsePaginatedListScrollOptions<T>) {
  const topObserverTarget = useRef<HTMLSpanElement>(null);
  const bottomObserverTarget = useRef<HTMLSpanElement>(null);

  const {
    items,
    targetRecordId,
    isLoadingPrevious,
    isLoadingNext,
    lastLoadDirection,
    hasPrevious,
    hasNext,
    fetchPrevious,
    fetchNext,
  } = query;

  const scrollState = useRef({
    hasScrolledToTarget: false,
    previousScrollHeight: 0,
    previousMessageCount: 0,
    previousScrollTop: 0,
  });

  const enableScrollManagement = Boolean(containerElementId && itemIdPrefix);

  // Preserve scroll position when loading items
  useEffect(() => {
    if (!enableScrollManagement) return;

    const wrapper = document.getElementById(containerElementId!);
    if (!wrapper) return;

    const itemCountChanged = items.length !== scrollState.current.previousMessageCount;

    if (itemCountChanged && !isLoadingPrevious && !isLoadingNext && lastLoadDirection) {
      // Items finished loading
      const currentScrollHeight = wrapper.scrollHeight;
      const heightDifference = currentScrollHeight - scrollState.current.previousScrollHeight;

      if (heightDifference > 0 && lastLoadDirection === 'previous') {
        // Loading previous (older) items at top
        // Adjust scroll to maintain visual position
        if (reverse) {
          wrapper.scrollTop = scrollState.current.previousScrollTop - heightDifference;
        } else {
          wrapper.scrollTop = scrollState.current.previousScrollTop + heightDifference;
        }
      }
      // When loading next (newer) items at bottom, no adjustment needed
      // The scroll position naturally stays the same since items are appended below
    }

    scrollState.current.previousMessageCount = items.length;
    scrollState.current.previousScrollHeight = wrapper.scrollHeight;
    scrollState.current.previousScrollTop = wrapper.scrollTop;
  }, [items.length, isLoadingPrevious, isLoadingNext, lastLoadDirection, containerElementId, enableScrollManagement, reverse]);

  // Reset scroll state when targetRecordId changes
  useEffect(() => {
    if (!enableScrollManagement) return;
    scrollState.current.hasScrolledToTarget = false;
  }, [targetRecordId, enableScrollManagement]);

  // Scroll to the target item
  useEffect(() => {
    if (!enableScrollManagement) return;

    const id = requestAnimationFrame(() => {
      const wrapper = document.getElementById(containerElementId!);
      if (!wrapper || !additionalScrollCondition) return;

      if (targetRecordId && !scrollState.current.hasScrolledToTarget && items.length > 0) {
        // Scroll to the target item (when using permalink or after creating/updating)
        const targetElement = document.getElementById(`${itemIdPrefix!}-${targetRecordId}`);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'instant', block: 'center' });
          scrollState.current.hasScrolledToTarget = true;
        }
      }
    });

    return () => cancelAnimationFrame(id);
  }, [targetRecordId, items.length, containerElementId, itemIdPrefix, additionalScrollCondition, enableScrollManagement]);

  // Set up intersection observer for top (previous/older items)
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (targetRecordId && !scrollState.current.hasScrolledToTarget) return;

        if (entries[0].isIntersecting && hasPrevious && !isLoadingPrevious) {
          fetchPrevious();
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = topObserverTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [fetchPrevious, hasPrevious, isLoadingPrevious, targetRecordId]);

  // Set up intersection observer for bottom (next/newer items)
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (targetRecordId && !scrollState.current.hasScrolledToTarget) return;

        if (entries[0].isIntersecting && hasNext && !isLoadingNext) {
          fetchNext();
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = bottomObserverTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [fetchNext, hasNext, isLoadingNext, targetRecordId]);

  return {
    topObserverTarget,
    bottomObserverTarget,
  };
}
