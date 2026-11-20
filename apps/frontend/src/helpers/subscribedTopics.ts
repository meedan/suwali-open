import type { SubscribedTopic } from '@services/HubService';

import Config from '@root/Config';

export const MIN_SILENT_WEEKS = 2;

// What counts as an audience worth flagging depends on how big a hub's audiences run, so this is
// deliberately tunable per environment rather than fixed
export const ABSOLUTE_MIN_SUBSCRIBERS = Number(Config.get('VITE_MIN_TOPIC_SUBSCRIBERS', '10')) || 10;

const documentsPerWeek = (topic: SubscribedTopic) => Object.values(topic.documents);

export const silentWeeks = (topic: SubscribedTopic) => {
  const weeks = documentsPerWeek(topic);
  const trailing = [...weeks].reverse().findIndex(documents => documents > 0);

  return trailing === -1 ? weeks.length : trailing;
};

// A topic with nothing all quarter is likelier retired or seasonal than neglected, so the card
// never asks for content it will never get. Stands in for archiving topics, which hubs cannot do.
const coveredThisQuarter = (topic: SubscribedTopic) => documentsPerWeek(topic).some(documents => documents > 0);

const quantile = (values: number[], fraction: number) => {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);

  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
};

export const audienceMin = (topics: SubscribedTopic[]) =>
  Math.max(ABSOLUTE_MIN_SUBSCRIBERS, quantile(topics.map(topic => topic.subscribers), 0.25));

export const hasEligibleAudience = (topics: SubscribedTopic[]) => {
  const min = audienceMin(topics);

  return topics.some(topic => topic.subscribers >= min);
};

export type SubscribedTopicPoint = {
  id: number;
  name: string;
  subscribers: number;
  weeks: number;
};

export const toSubscribedTopicPoints = (topics: SubscribedTopic[]): SubscribedTopicPoint[] =>
  topics.map(topic => ({
    id: topic.id,
    name: topic.name,
    subscribers: topic.subscribers,
    weeks: silentWeeks(topic),
  }));

export type Waiting = 'weeks' | 'months';

const WEEKS_IN_MONTH = 4;

// Where on the silence axis each option sits. Unlike terciles these are absolute: an editor asking
// which audiences have waited months means months, however long this hub's longest silence is.
export const waitingBand = (waiting: Waiting, maxWeeks: number): [number, number] => {
  const month = Math.min(WEEKS_IN_MONTH, maxWeeks);

  return waiting === 'weeks' ? [Math.min(MIN_SILENT_WEEKS, month), month] : [month, maxWeeks];
};

export const bySubscribers = (a: SubscribedTopicPoint, b: SubscribedTopicPoint) =>
  b.subscribers - a.subscribers || b.weeks - a.weeks || a.name.localeCompare(b.name);

export const selectStaleTopic = (topics: SubscribedTopic[]): SubscribedTopic | undefined => {
  const min = audienceMin(topics);

  const eligible = topics.filter(topic =>
    topic.subscribers >= min &&
    coveredThisQuarter(topic) &&
    silentWeeks(topic) >= MIN_SILENT_WEEKS
  );
  const winner = toSubscribedTopicPoints(eligible).sort(bySubscribers)[0];

  return topics.find(topic => topic.id === winner?.id);
};
