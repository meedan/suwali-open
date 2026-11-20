import { rollingWeeks } from '@helpers/dashboardWidgets';

import { fetchStatistics } from '@services/HubService';

type StatisticsQueryParams = {
  hubId?: number | string | null;
  fields: string[];
  groupBy: 'day' | 'rolling_week' | 'range';
  weeks: number;
  limit?: number;
};

export const statisticsQuery = ({ hubId, fields, groupBy, weeks, limit }: StatisticsQueryParams) => {
  const { from, to } = rollingWeeks(weeks);

  return {
    queryKey: [`/hubs/${hubId}/statistics`, `fields:${fields.join(',')}`, `group_by:${groupBy}`, `from:${from}`, `to:${to}`, `limit:${limit}`],
    queryFn: () => fetchStatistics({ hubId: hubId!, fields, group_by: groupBy, limit, from, to }),
  };
};
