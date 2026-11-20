import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { sameItems, splitList } from '@helpers/lists';

export type SortKey =
  | 'title'
  | 'content'
  | 'updated_at'
  | 'published_at'
  | 'last_message'
  | 'last_summary_updated_by_id'
  | 'user'
  | 'platform'
  | 'messages_count'
  | 'sync_status'
  | 'priority_tier';

export type DocumentsFilter = {
  date_modified?: string;
  date_published?: string;
  status?: 'paused' | 'active' | 'all';
  notebooks?: 'true' | 'false' | 'all';
  platforms?: string;
  published_by?: string;
  sync_status?: string;
  sort_by?: SortKey;
  sort_direction?: 'asc' | 'desc';
  last_message?: string;
  first_message?: string;
  participants?: string;
  has_message?: string;
  priority_tier?: '1' | '2' | 'all';
  // Topic ids, and "none" for the items that have no topics, separated by commas
  topics?: string;
  // Whether those that have the topics are shown, or all but those. Only said when it is all but those.
  topics_mode?: 'exclude';
};

const FILTER_KEYS: (keyof DocumentsFilter)[] = [
  'date_modified',
  'date_published',
  'status',
  'notebooks',
  'platforms',
  'published_by',
  'sync_status',
  'sort_by',
  'sort_direction',
  'last_message',
  'first_message',
  'participants',
  'has_message',
  'priority_tier',
  'topics',
  'topics_mode',
];

const SORT_KEYS: (keyof DocumentsFilter)[] = [
  'sort_by',
  'sort_direction',
];

// Not a filter of its own, but how the topics are one, so it is not counted beside them
const UNCOUNTED_KEYS: (keyof DocumentsFilter)[] = [...SORT_KEYS, 'topics_mode'];

export function getCurrentFromParams(params: URLSearchParams): DocumentsFilter {
  const filter: DocumentsFilter = {};

  for (const key of FILTER_KEYS) {
    if (!params.has(key)) continue;

    if (key === 'platforms') {
      const values = params.getAll('platforms');

      if (values.length > 0) {
        filter.platforms = values.join(',');
      }

      continue;
    }

    const value = params.get(key);

    if (value !== null && value !== '') {
      (filter as Record<string, string>)[key] = value;
    }
  }

  return filter;
}

function removeUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([, value]) => value !== undefined && value !== '',
    ),
  ) as Partial<T>;
}

function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  const clone = { ...obj };

  for (const key of keys) {
    delete clone[key];
  }

  return clone;
}

// defaultLists: what the filters that hold several choose while they are not set. Choosing just those is not
// filtering, so it is not counted, as the chips of what a list is filtered by do not show it either
export function useFilterAndSort(defaultQuery: DocumentsFilter, defaultLists: Record<string, string[]> = {}) {
  const [params, setParams] = useSearchParams();

  const currentQuery = useMemo(
    () => ({
      ...defaultQuery,
      ...getCurrentFromParams(params),
    }),
    [defaultQuery, params],
  );

  const [stateQuery, setStateQuery] = useState<DocumentsFilter>(currentQuery);

  const syncParams = (query: DocumentsFilter) => {
    const cleaned = removeUndefined(query);
    const updatedParams = new URLSearchParams();

    Object.entries(cleaned).forEach(([key, value]) => {
      updatedParams.set(key, String(value));
    });

    setParams(updatedParams);
  };

  const applyFilter = (
    overrides?: Partial<DocumentsFilter>,
  ) => {
    const nextQuery = {
      ...currentQuery,
      ...omit(stateQuery, SORT_KEYS),
      ...overrides,
    };

    syncParams(nextQuery);
  };

  // Changes the filters that are applied now, as a chip that stops one does, so what the filter dialog has
  // chosen but not applied is dropped with it
  const updateFilter = (overrides: Partial<DocumentsFilter>) => {
    const nextQuery = { ...currentQuery, ...overrides };

    setStateQuery(nextQuery);
    syncParams(nextQuery);
  };

  const applySort = () => {
    const nextQuery = {
      ...currentQuery,
      sort_by: stateQuery.sort_by,
      sort_direction: stateQuery.sort_direction,
    };

    syncParams(nextQuery);
  };

  const resetFilter = () => {
    const nextQuery = {
      ...defaultQuery,
      sort_by: currentQuery.sort_by,
      sort_direction: currentQuery.sort_direction,
    };

    setStateQuery({
      ...nextQuery,
    });

    syncParams(nextQuery);
  };

  const resetSort = () => {
    const nextQuery = omit(currentQuery, SORT_KEYS);

    syncParams(nextQuery);

    setStateQuery({
      ...currentQuery,
      sort_by: defaultQuery.sort_by,
      sort_direction: defaultQuery.sort_direction,
    });
  };

  const discardChanges = () => {
    setStateQuery(currentQuery);
  };

  const setFilter = <K extends keyof DocumentsFilter>(
    key: K,
    value: DocumentsFilter[K],
  ) => {
    setStateQuery(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const applyQuery = (query: DocumentsFilter) => {
    setParams({ ...query });
  };

  // 'any' is how a filter is explicitly cleared, as message permalinks do with platforms=any
  const activeFiltersCount = Object.entries(
    omit(currentQuery, UNCOUNTED_KEYS),
  ).filter(([key, value]) => (
    Boolean(value) && value !== 'any' && !(key in defaultLists && sameItems(splitList(String(value)), defaultLists[key]))
  )).length;

  const isSortActive =
    currentQuery.sort_by !== defaultQuery.sort_by ||
    currentQuery.sort_direction !== defaultQuery.sort_direction;

  return {
    currentQuery,
    stateQuery,

    applyQuery,
    applyFilter,
    updateFilter,
    applySort,

    resetFilter,
    resetSort,

    discardChanges,
    setFilter,

    isSortActive,
    activeFiltersCount,
  };
}
