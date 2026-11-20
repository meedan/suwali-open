import { useQueries } from '@tanstack/react-query';

import type { ConversationFrom } from '@customTypes/conversation';

import { fetchConversations } from '@services/ConversationsService';

import type { DocumentsFilter } from '@hooks/useFilterAndSort';

export type ConversationCounts = Partial<Record<ConversationFrom, number>>;

// Counts each conversation type with its own filters, so every count matches what that type's list
// would show. Keys share the `/hubs/:id/conversations` prefix, so invalidating conversations refreshes them.
export function useConversationCounts(
  hubId: number | null,
  filters: Record<ConversationFrom, DocumentsFilter>,
): ConversationCounts {
  const types = Object.keys(filters) as ConversationFrom[];

  const results = useQueries({
    queries: types.map((from) => {
      const filter = { ...filters[from], from };

      return {
        queryKey: [`/hubs/${hubId}/conversations`, 'count', `filter:${JSON.stringify(filter)}`],
        // A window of one is enough — only the pagination total is read
        queryFn: () => fetchConversations(hubId!, null, 1, filter),
        select: (response: Awaited<ReturnType<typeof fetchConversations>>) => response.pagination.total_count,
        enabled: Boolean(hubId),
      };
    }),
  });

  return Object.fromEntries(types.map((from, index) => [from, results[index].data]));
}
