import { SERIES_WEEKS } from '@helpers/dashboardWidgets';

import { statisticsQuery } from './statisticsQuery';

export const SUBSCRIBED_TOPICS_LIMIT = 100;

export const subscribedTopicsQuery = (hubId?: number | string | null) =>
  statisticsQuery({ hubId, fields: ['subscribed_topics'], groupBy: 'rolling_week', weeks: SERIES_WEEKS, limit: SUBSCRIBED_TOPICS_LIMIT });
