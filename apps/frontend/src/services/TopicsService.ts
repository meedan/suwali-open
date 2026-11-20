import type { HubTopicsPage } from '@customTypes/topic';

import { NetworkLayer } from '@root/NetworkLayer';

export const deleteTopicItem = async (topicItemId: number): Promise<void> => {
  await NetworkLayer.delete(`/topic-items/${topicItemId}`);
};

type HubTopicsScope = {
  // The topics of a list of the data sources, with how many of its items each is on, and not of all the hub
  itemType?: 'Document' | 'Contribution' | 'Notebook';
  // With documents, of the list of this data source
  sourceId?: number;
  // Only these topics, separated by commas
  ids?: string;
};

// A page of the topics of a hub by name, the ones whose name contains the search if there is one
export const fetchHubTopics = async (
  hubId: number | string,
  page: number,
  perPage: number,
  search: string,
  scope: HubTopicsScope = {},
): Promise<HubTopicsPage> => {
  const queryParams = new URLSearchParams({ page: page.toString(), per_page: perPage.toString() });
  if (search) queryParams.set('q', search);
  if (scope.itemType) queryParams.set('item_type', scope.itemType);
  if (scope.sourceId) queryParams.set('source_id', scope.sourceId.toString());
  if (scope.ids) queryParams.set('ids', scope.ids);
  const response = await NetworkLayer.get<HubTopicsPage>(`/hubs/${hubId}/topics?${queryParams}`);
  return response.data;
};

type AddTopicItemParams = {
  itemType: 'Document' | 'Contribution' | 'Notebook';
  itemId: number;
} & (
  // A topic the hub has, or one named, which is created if the hub has none of that name
  | { topicId: number }
  | { topicName: string }
);

export type AddTopicItemResponse = {
  // The topic item's, not the topic's
  id: number;
  name: string;
  topic_created: boolean;
};

export const addTopicItem = async (params: AddTopicItemParams): Promise<AddTopicItemResponse> => {
  const topic = 'topicId' in params ? { topic_id: params.topicId } : { topic_name: params.topicName };
  const response = await NetworkLayer.post<AddTopicItemResponse>('/topic-items', { ...topic, item_type: params.itemType, item_id: params.itemId });
  return response.data;
};
