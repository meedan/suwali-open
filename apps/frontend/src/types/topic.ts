import type { PaginationMetadata } from './pagination-metadata';

export type Topic = {
  id: number;
  name: string;
};

// A topic as it is on a data source item: id is the link between the two, which removes it from the item
export type ItemTopic = Topic & {
  topic_id: number;
};

// A topic of a hub, with how many data source items it is on
export type HubTopic = Topic & {
  items_count: number;
};

export type HubTopicsPage = {
  data: HubTopic[];
  pagination: PaginationMetadata;
  // Of the list the topics were asked for, how many of its items have no topics
  untagged_count?: number;
};
