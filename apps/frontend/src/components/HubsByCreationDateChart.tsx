import { defineMessages, useIntl } from 'react-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { CHART_VISUAL_CONSTANTS, formatDay, formatDayShort, makeCountTooltipFormatter, TOOLTIP_STYLES } from '@helpers/chart';

import type { HubsByCreationDateBucket } from '@services/AdminService';

import ChartLegend from '@ui-components/layout/Legend';

const messages = defineMessages({
  active: {
    id: 'global.active',
    defaultMessage: 'Active',
    description: 'Generic label for active/live items',
  },
  deleted: {
    id: 'global.deleted',
    defaultMessage: 'Deleted',
    description: 'Generic label or title for deleted items',
  },
});

const COLORS = {
  active: 'var(--color-purple-67)',
  deleted: 'var(--color-pink-53)',
};

const HubsByCreationDateChart = ({ data, height }: {
  data: HubsByCreationDateBucket[],
  height: number,
}) => {
  const intl = useIntl();
  const names = {
    active: intl.formatMessage(messages.active),
    deleted: intl.formatMessage(messages.deleted),
  };

  return (
    <BarChart
      data={data}
      height={height}
      margin={CHART_VISUAL_CONSTANTS.MARGINS}
      responsive
      width="100%"
    >
      <CartesianGrid vertical={false} stroke="var(--border-color-chart)" />
      <XAxis
        dataKey="date"
        tickFormatter={(value: string) => formatDayShort(value, intl)}
        tick={CHART_VISUAL_CONSTANTS.AXIS_TICK}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        allowDecimals={false}
        tick={CHART_VISUAL_CONSTANTS.AXIS_TICK}
        axisLine={false}
        tickLine={false}
        width={CHART_VISUAL_CONSTANTS.AXIS_WIDTH}
      />
      <Tooltip
        contentStyle={TOOLTIP_STYLES.CONTENT}
        itemStyle={TOOLTIP_STYLES.ITEM}
        labelStyle={TOOLTIP_STYLES.LABEL}
        labelFormatter={(value) => formatDay(value, intl)}
        formatter={makeCountTooltipFormatter(COLORS, intl)}
        wrapperStyle={{ zIndex: 10 }}
        cursor={false}
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
      <Bar dataKey="active" stackId="a" fill={COLORS.active} background={false} name={names.active} />
      <Bar dataKey="deleted" stackId="a" fill={COLORS.deleted} background={false} name={names.deleted} />
    </BarChart>
  );
};

export default HubsByCreationDateChart;
