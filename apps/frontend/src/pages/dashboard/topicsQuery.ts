import { MONTH_WEEKS } from '@helpers/dashboardWidgets';

import { statisticsQuery } from './statisticsQuery';

export const TOPICS_LIMIT = 100;

// The collapsed card and the expanded chart rank the same topics over the same window — the card
// shows the table's first row — so they issue one identical query and share its cache.
export const topicsQuery = (hubId?: number | string | null) =>
  statisticsQuery({ hubId, fields: ['top_topics'], groupBy: 'range', weeks: MONTH_WEEKS, limit: TOPICS_LIMIT });
