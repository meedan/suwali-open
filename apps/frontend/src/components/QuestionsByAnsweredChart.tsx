import { useCallback } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip,
  type TooltipPayloadEntry,
  XAxis,
  YAxis,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';

import type { QuestionsByAnswered } from '@customTypes/statistics';

import { CHART_VISUAL_CONSTANTS, formatDay, formatDayShort, renderTooltipRow, TOOLTIP_STYLES } from '@helpers/chart';
import { unansweredRate } from '@helpers/questions';

import ChartLegend from '@ui-components/layout/Legend';

const messages = defineMessages({
  answered: {
    id: 'global.answered',
    defaultMessage: '# Answered',
    description: 'Reusable label for questions the chatbot managed to answer',
  },
  unanswered: {
    id: 'global.unanswered',
    defaultMessage: '# Unanswered',
    description: 'Reusable label for questions the chatbot could not answer',
  },
  unansweredRate: {
    id: 'global.percentUnanswered',
    defaultMessage: '% Unanswered',
    description: 'Chart legend for the share of questions the chatbot could not answer',
  },
  answeredTooltip: {
    id: 'global.xAnswered',
    defaultMessage: '{value} Answered',
    description: 'Chart tooltip row: how many questions the chatbot answered in a period',
  },
  unansweredTooltip: {
    id: 'global.xUnanswered',
    defaultMessage: '{value} Unanswered',
    description: 'Chart tooltip row: how many questions the chatbot left unanswered in a period, or what share of them it left unanswered',
  },
});

const COLORS: Record<string, string> = {
  answered: 'var(--color-purple-67)',
  unanswered: 'var(--color-orange-59)',
  rate: 'var(--color-green-68)',
} as const;

// Answered and unanswered questions per bucket, stacked, with the share unanswered as a line on
// its own percentage axis: the counts say how much came in, the line says how well it went.
const QuestionsByAnsweredChart = ({ data, height }: {
  data: QuestionsByAnswered[],
  height: number,
}) => {
  const intl = useIntl();
  const points = data.map(week => ({ ...week, rate: unansweredRate(week) }));

  const names: Record<string, string> = {
    answered: intl.formatMessage(messages.answered),
    unanswered: intl.formatMessage(messages.unanswered),
    rate: intl.formatMessage(messages.unansweredRate),
  };

  const tooltipFormatter = useCallback((value: ValueType | undefined, _name: NameType | undefined, entry: TooltipPayloadEntry) => {
    if (typeof value !== 'number' || typeof entry.dataKey !== 'string') return null;

    const formattedValue = entry.dataKey === 'rate' ?
      intl.formatNumber(Number(value ?? 0) / 100, { style: 'percent', maximumFractionDigits: 0 }) :
      intl.formatNumber(Number(value ?? 0));

    const content = intl.formatMessage(entry.dataKey === 'answered' ? messages.answeredTooltip : messages.unansweredTooltip,
      { value: formattedValue },
    );
    return renderTooltipRow(entry.dataKey, COLORS[entry.dataKey], content);
  }, [intl]);

  return (
    <ComposedChart
      data={points}
      height={height}
      margin={CHART_VISUAL_CONSTANTS.MARGINS}
      responsive
      width="100%"
    >
      <CartesianGrid vertical={false} stroke="var(--border-color-chart)" yAxisId="count" />
      <XAxis
        dataKey="date"
        tickFormatter={(value: string) => formatDayShort(value, intl)}
        tick={CHART_VISUAL_CONSTANTS.AXIS_TICK}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        yAxisId="count"
        allowDecimals={false}
        tick={CHART_VISUAL_CONSTANTS.AXIS_TICK}
        axisLine={false}
        tickLine={false}
        width={CHART_VISUAL_CONSTANTS.AXIS_WIDTH}
      />
      <YAxis
        yAxisId="rate"
        orientation="right"
        domain={[0, 100]}
        tickFormatter={(value: number) => intl.formatNumber(value / 100, { style: 'percent' })}
        tick={CHART_VISUAL_CONSTANTS.AXIS_TICK}
        axisLine={false}
        tickLine={false}
        width={CHART_VISUAL_CONSTANTS.AXIS_WIDTH}
      />
      <Tooltip
        cursor={false}
        labelFormatter={(label) => formatDay(label, intl)}
        contentStyle={TOOLTIP_STYLES.CONTENT}
        itemStyle={TOOLTIP_STYLES.ITEM}
        labelStyle={TOOLTIP_STYLES.LABEL}
        formatter={tooltipFormatter}
      />
      <Legend
        align="left"
        wrapperStyle={{ paddingLeft: `${CHART_VISUAL_CONSTANTS.AXIS_WIDTH}px` }}
        content={({ payload }) => (
          <ChartLegend
            items={(payload ?? []).map(entry => ({
              key: String(entry.dataKey),
              color: entry.color ?? '',
              label: entry.value,
            }))}
          />
        )}
      />
      <Bar yAxisId="count" dataKey="answered" stackId="a" fill={COLORS.answered} background={false} name={names.answered} />
      <Bar yAxisId="count" dataKey="unanswered" stackId="a" fill={COLORS.unanswered} background={false} name={names.unanswered} />
      <Line
        yAxisId="rate"
        type="monotone"
        dataKey="rate"
        stroke={COLORS.rate}
        strokeWidth={CHART_VISUAL_CONSTANTS.STROKE_WIDTH}
        dot={{ r: CHART_VISUAL_CONSTANTS.DOT_RADIUS, fill: COLORS.rate }}
        name={names.rate}
      />
    </ComposedChart>
  );
};

export default QuestionsByAnsweredChart;
