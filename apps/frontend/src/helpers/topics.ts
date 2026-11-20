import type { TopTopic } from '@services/HubService';

export type TopicPoint = {
  id: number;
  name: string;
  asks: number;
  documents: number;
};

const latest = (series: Record<string, number>) => Object.values(series).pop() ?? 0;

export const toTopicPoints = (topics: TopTopic[]): TopicPoint[] =>
  topics.map(topic => ({
    id: topic.id,
    name: topic.name,
    asks: latest(topic.messages),
    documents: latest(topic.data_source_items),
  }));

// Rounded, because it is what the table prints: sorting on the exact value would order rows that
// read alike in a way nothing on screen explains. A topic nobody could answer has an infinite
// ratio, which sorts it first: no coverage at all is the widest gap there is.
export const asksPerDocument = ({ asks, documents }: TopicPoint) =>
  documents === 0 ? Infinity : Math.round(asks / documents);

// Widest gap first, so the card and the table order topics the same way: asks per document, then
// asks, then documents, then the name. A topic with no documents at all has the least coverage
// there is, so it leads.
export const byGapSeverity = (a: TopicPoint, b: TopicPoint) => {
  const ratioA = asksPerDocument(a);
  const ratioB = asksPerDocument(b);
  if (ratioA !== ratioB) return ratioB - ratioA;
  return b.asks - a.asks || b.documents - a.documents || a.name.localeCompare(b.name);
};

// The topic the collapsed card headlines. Deliberately the same rule the expanded table sorts by,
// with no filtering of its own, so the card always shows that table's first row.
export const selectGapTopic = (topics: TopTopic[]): TopTopic | undefined => {
  const winner = toTopicPoints(topics).sort(byGapSeverity)[0];

  return topics.find(topic => topic.id === winner?.id);
};
