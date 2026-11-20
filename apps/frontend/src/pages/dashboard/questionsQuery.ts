import { lastReportedDay, SERIES_WEEKS } from '@helpers/dashboardWidgets';

import { fetchQuestionsRanking } from '@services/HubService';

import { statisticsQuery } from './statisticsQuery';

export const TOP_QUESTIONS_LIMIT = 10;

// The card's sparkline needs a longer window than the month it reports on, and the expanded chart
// reads the last buckets of that same series, so both share one query and its cache.
export const questionsQuery = (hubId?: number | string | null) =>
  statisticsQuery({ hubId, fields: ['questions_by_answered'], groupBy: 'rolling_week', weeks: SERIES_WEEKS });

// `from` comes from the series itself, not a date computed here, and `to` matches where the series
// stops, so the questions listed are exactly the ones counted in the buckets the card reports on.
export const unansweredQuestionsQuery = (hubId?: number | string | null, from?: string, perPage = 1) => {
  const to = lastReportedDay();

  return {
    queryKey: [`/hubs/${hubId}/questions-ranking`, 'answered:false', `from:${from}`, `to:${to}`, `per_page:${perPage}`],
    queryFn: () => fetchQuestionsRanking({
      hubId: hubId!,
      answered: false,
      page: 1,
      perPage,
      from,
      to,
    }),
  };
};
