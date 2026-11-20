import { useQuery } from '@tanstack/react-query';

import { fetchHubTopics } from '@services/TopicsService';

import { useSession } from '@root/SessionContext';

type ItemType = 'Document' | 'Contribution' | 'Notebook';

// What the topics are called, which the address only has the ids of, by id. Once looked up, an id that has no name
// is of a topic that is gone, such as from a link or a list remembered
export function useTopicNames(itemType: ItemType, sourceId: number | undefined, ids: string) {
  const hubId = useSession().currentHubId();

  const { data: named, isSuccess } = useQuery({
    queryKey: [`/hubs/${hubId}/topics`, 'named', itemType, sourceId ?? '', ids],
    queryFn: () => fetchHubTopics(hubId!, 1, 100, '', { itemType, sourceId, ids }),
    enabled: Boolean(hubId) && ids !== '',
  });

  return { names: new Map((named?.data ?? []).map(topic => [String(topic.id), topic.name])), isLoaded: isSuccess };
}
