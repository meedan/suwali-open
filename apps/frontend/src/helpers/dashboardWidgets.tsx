import { FormattedMessage } from "react-intl";

import type { SparkLineData, TrendColor, TrendDateRange, TrendDirection } from "@ui-components/layout/Widget";

export const getSeriesAverage = (sparkLineData: SparkLineData) => sparkLineData.reduce((sum, { value }) => sum + value, 0) / sparkLineData.length;

// UTC throughout: the endpoint buckets on UTC timestamps and labels the buckets it returns with
// UTC dates, and counting back in local days would shift the window by one across a DST change.
const isoDate = (date: Date) => date.toISOString().split('T')[0];

// The last day the dashboard reports on. It stops at yesterday because today is still in progress:
// counting it would make the newest period shorter than the ones it is compared against.
export const lastReportedDay = () => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return isoDate(date);
};

// Whole seven-day periods ending yesterday. Measured from the window rather than the calendar, so
// every period is the same length whichever day the dashboard is opened.
export const rollingWeeks = (weeks: number) => {
  const to = lastReportedDay();
  const from = new Date(`${to}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - (weeks * 7 - 1));
  return { from: isoDate(from), to };
};

// Every widget charts the same window, so two of them can be read side by side
export const SERIES_WEEKS = 12;

// Every widget reads the same weekly series and differs only in how many of its last buckets the
// headline covers: a month is the last four, a week is the last one.
export const MONTH_WEEKS = 4;

const WINDOW_BUCKETS = { week: 1, month: MONTH_WEEKS } as const;

export type TrendPeriod = keyof typeof WINDOW_BUCKETS;

// `offset` counts back from the end of the series, 1 being the latest bucket
const sumWindow = (sparkLineData: SparkLineData, offset: number, buckets: number) => {
  let sum = 0;
  for (let i = offset; i < offset + buckets; i++) {
    const index = sparkLineData.length - i;
    if (index < 0) break;
    sum += sparkLineData[index].value;
  }
  return sum;
};

// The window a trend's comparison covers: from the start of its oldest bucket to the end of the
// last completed week.
export const getTrendDateRange = (dates: (string | undefined)[], buckets: number): TrendDateRange | undefined => {
  const from = dates[dates.length - buckets];
  return from ? { from, to: lastReportedDay() } : undefined;
};

export const getThisMonthTotal = (sparkLineData: SparkLineData) => sumWindow(sparkLineData, 1, WINDOW_BUCKETS.month);

export const getPastMonthTotal = (sparkLineData: SparkLineData) => sumWindow(sparkLineData, WINDOW_BUCKETS.month + 1, WINDOW_BUCKETS.month);

export const getPercentageChange = (thisMonth: number, pastMonth: number) => pastMonth ? ((thisMonth - pastMonth) / pastMonth) * 100 : null;

export const getTrendColor = (thisMonth: number, pastMonth: number): TrendColor => {
  if (thisMonth === pastMonth) return 'neutral';

  return thisMonth > pastMonth ? 'green' : 'red';
};

export const getTrendDirection = (thisMonth: number, pastMonth: number): TrendDirection => {
  if (thisMonth === pastMonth) return 'nochange';

  return thisMonth > pastMonth ? 'up' : 'down';
};

export const getTrendLabel = (period: TrendPeriod, trendDirection: TrendDirection, comparisonValue: number | null) => {
  if (trendDirection === 'nochange') {
    return period === 'week' ? (
      <FormattedMessage
        id="global.noChangeVsLastWeek"
        defaultMessage="No change vs last week"
        description="Value comparison against different data points"
      />
    ) : (
      <FormattedMessage
        id="global.noChangeVsLastMonth"
        defaultMessage="No change vs last month"
        description="Value comparison against different data points"
      />
    );
  }

  if (comparisonValue === null) return false;

  const value = `${comparisonValue > 0 ? '+' : ''}${Math.round(comparisonValue)}`;

  return period === 'week' ? (
    <FormattedMessage
      id="global.xPercentVsLastWeek"
      defaultMessage="<strong>{value}%</strong> vs <underline>last week</underline>"
      description="Value comparison against different data points"
      values={{
        value, strong: msg => <strong key="strong">{msg}</strong>,
        underline: msg => <abbr key="underline">{msg}</abbr>,
      }}
    />
  ) : (
    <FormattedMessage
      id="global.xPercentVsPastMonth"
      defaultMessage="<strong>{value}%</strong> vs <underline>past month</underline>"
      description="Value comparison against different data points"
      values={{
        value, strong: msg => <strong key="strong">{msg}</strong>,
        underline: msg => <abbr key="underline">{msg}</abbr>,
      }}
    />
  );
};

// Everything <Widget.Trend> needs from a weekly series, so the widgets that count a total over a
// window agree on how the window, the comparison and the empty state are read.
export const getTrendProps = (sparkLineData: SparkLineData, period: TrendPeriod) => {
  const buckets = WINDOW_BUCKETS[period];
  const current = sumWindow(sparkLineData, 1, buckets);
  const previous = sumWindow(sparkLineData, buckets + 1, buckets);
  const hasData = sparkLineData.some(({ value }) => value > 0);
  const direction = getTrendDirection(current, previous);

  return {
    current,
    previous,
    hasData,
    trend: {
      color: getTrendColor(current, previous),
      data: sparkLineData,
      dateRange: getTrendDateRange(sparkLineData.map(({ date }) => date), buckets),
      direction,
      label: hasData && getTrendLabel(period, direction, getPercentageChange(current, previous)),
      referenceValue: hasData ? getSeriesAverage(sparkLineData) : 0,
      noData: !hasData,
    },
  };
};
