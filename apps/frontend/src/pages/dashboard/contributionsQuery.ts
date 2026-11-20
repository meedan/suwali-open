import { SERIES_WEEKS } from '@helpers/dashboardWidgets';

import { statisticsQuery } from './statisticsQuery';

export const contributionsQuery = (hubId?: number | string | null) =>
  statisticsQuery({ hubId, fields: ['contributions_by_contributor'], groupBy: 'rolling_week', weeks: SERIES_WEEKS });
