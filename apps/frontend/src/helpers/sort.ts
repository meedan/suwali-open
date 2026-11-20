import type { SortKey } from '@hooks/useFilterAndSort';

export type Sortable = 'contribution' | 'document' | 'summary' | 'conversation';

export const typeDefault: Record<Sortable, SortKey> = {
  contribution: 'updated_at',
  document: 'updated_at',
  summary: 'updated_at',
  conversation: 'last_message',
};

const TEXT_SORT_KEYS: SortKey[] = ['title', 'content', 'platform'];

// Text reads A to Z first; dates and counts read newest and most first
export const defaultSortDirection = (sortKey: SortKey): 'asc' | 'desc' =>
  TEXT_SORT_KEYS.includes(sortKey) ? 'asc' : 'desc';
