import clsx from 'clsx';
import React from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from "react-router";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';

import type { CustomTickProps, DotProps } from '@helpers/chart';
import {
  calculateYAxisDomain,
  CHART_VISUAL_CONSTANTS,
  formatDay,
  formatDayShort,
  renderTooltipRow,
  TOOLTIP_STYLES,
} from '@helpers/chart';
import { MONTH_WEEKS, rollingWeeks, SERIES_WEEKS } from '@helpers/dashboardWidgets';

import { useSession } from '@root/SessionContext';

import { useHubPath } from "@hooks/useHubPath";

import Button from "@ui-components/input/Button";
import { ExpandedWidget } from '@ui-components/layout/ExpandedWidget';

import ContextChart from './ContextChart';
import styles from './LineChart.module.css';
import { statisticsQuery } from './statisticsQuery';
import StatsPanel from './StatsPanel';

// Constants
// Opens on the same month the other expanded charts report on
const DEFAULT_VISIBLE_DAYS = MONTH_WEEKS * 7;
const CHART_HEIGHT = 180;
const AXIS_HEIGHT = 30;

/**
 * Custom X-axis tick component that aligns first/last ticks to prevent overflow
 * - First tick: left-aligned
 * - Last tick: right-aligned
 * - Middle ticks: center-aligned
 */
export const CustomXAxisTick: React.FC<CustomTickProps> = ({
  x,
  y,
  payload,
  index,
  visibleTicksCount,
  formatter
}) => {
  let textAnchor: 'start' | 'middle' | 'end' = 'middle';

  if (index === 0) {
    textAnchor = 'start';
  } else if (index === visibleTicksCount - 1) {
    textAnchor = 'end';
  }

  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      {...CHART_VISUAL_CONSTANTS.AXIS_TICK}
    >
      {formatter(payload.value)}
    </text>
  );
};

const LineChart = ({ onClose, onSendToTop }: {
  onClose?: () => void,
  onSendToTop?: () => void,
}) => {
  const hubId = useSession().currentHubId();
  const intl = useIntl();
  const navigate = useNavigate();
  const hubPath = useHubPath();

  const { data, isPending } = useQuery({
    ...statisticsQuery({
      hubId,
      fields: ['number_of_new_conversations', 'number_of_continued_conversations'],
      groupBy: 'day',
      weeks: SERIES_WEEKS,
    }),
    enabled: Boolean(hubId),
    throwOnError: true,
  });

  const [brushRange, setBrushRange] = React.useState({ startIndex: 0, endIndex: 0 });

  // Memoized date formatters that use react-intl
  const dateFormatters = React.useMemo(() => ({
    formatDay: (day: string) => formatDay(day, intl),
    formatDayShort: (day: string) => formatDayShort(day, intl),
  }), [intl]);

  // Memoized data calculations
  const { chartData, seriesKeys, seriesColors, seriesDashArrays, seriesLabels, seriesIndicators } = React.useMemo(() => {
    if (!data?.number_of_new_conversations) {
      return { chartData: [], seriesKeys: [], seriesColors: {}, seriesDashArrays: {} as Record<string, string | undefined>, seriesLabels: {}, seriesIndicators: {} as Record<string, React.ReactNode> };
    }

    const seriesByKey: Record<string, Record<string, number>> = {
      conversations_new: data.number_of_new_conversations!,
      conversations_continued: data.number_of_continued_conversations!,
    };

    const colors: Record<string, string> = {
      conversations_new: 'var(--color-positive)',
      conversations_continued: 'var(--color-neutral)',
    };

    const dashArrays: Record<string, string | undefined> = {
      conversations_new: undefined,
      conversations_continued: '8 4',
    };

    const indicators: Record<string, React.ReactNode> = {
      conversations_new: '⬤',
      conversations_continued: <span style={{ fontSize: '1.4em', lineHeight: 1 }}>▲</span>,
    };

    const labels: Record<string, React.ReactNode> = {
      conversations_new: (
        <FormattedMessage
          id="global.lineChartconversationsNew"
          defaultMessage="New"
          description="Label for chart tooltip"
        />
      ),
      conversations_continued: (
        <FormattedMessage
          id="global.lineChartconversationsContinued"
          defaultMessage="Continued"
          description="Label for chart tooltip"
        />
      ),
    };

    const keys = Object.keys(seriesByKey);
    const allDays = Array.from(
      new Set(keys.flatMap((k) => Object.keys(seriesByKey[k])))
    ).sort();

    const processedData = allDays.map((day) => {
      const row: Record<string, number | string> = { day };
      for (const key of keys) {
        row[key] = seriesByKey[key][day] ?? 0;
      }
      // Add total for brush visualization
      const newConversations = row.conversations_new as number;
      const continuedConversations = row.conversations_continued as number;
      row.conversations_total = newConversations + continuedConversations;
      return row;
    });

    return {
      chartData: processedData,
      seriesKeys: keys,
      seriesColors: colors,
      seriesDashArrays: dashArrays,
      seriesLabels: labels,
      seriesIndicators: indicators,
    };
  }, [data]);

  const brushInitialized = React.useRef(false);

  // Initialize brush range when data loads
  React.useEffect(() => {
    if (chartData.length > 0 && !brushInitialized.current) {
      brushInitialized.current = true;
      setBrushRange({
        startIndex: Math.max(0, chartData.length - DEFAULT_VISIBLE_DAYS),
        endIndex: chartData.length - 1,
      });
    }
  }, [chartData.length]);

  const handleRangeChange = React.useCallback((startIndex: number, endIndex: number) => {
    setBrushRange({ startIndex, endIndex });
  }, []);

  const [hiddenSeries, setHiddenSeries] = React.useState<Set<string>>(new Set());

  const toggleSeries = React.useCallback((key: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const renderLegendIcon = React.useCallback((key: string) => {
    const color = seriesColors[key];
    const dashArray = seriesDashArrays[key];
    const r = CHART_VISUAL_CONSTANTS.ACTIVE_DOT_RADIUS;
    const w = 40;
    const h = 14;
    const cy = h / 2;
    const cx = w / 2;
    if (key === 'conversations_continued') {
      const tr = r * 1.4;
      return (
        <svg aria-hidden width={w} height={h}>
          <line x1={0} y1={cy} x2={w} y2={cy} stroke={color} strokeWidth={CHART_VISUAL_CONSTANTS.STROKE_WIDTH} strokeDasharray={dashArray} />
          <polygon points={`${cx},${cy - tr} ${cx + tr * 0.866},${cy + tr * 0.5} ${cx - tr * 0.866},${cy + tr * 0.5}`} fill={color} />
        </svg>
      );
    }
    return (
      <svg aria-hidden width={w} height={h}>
        <line x1={0} y1={cy} x2={w} y2={cy} stroke={color} strokeWidth={CHART_VISUAL_CONSTANTS.STROKE_WIDTH} />
        <circle cx={cx} cy={cy} r={r} fill={color} />
      </svg>
    );
  }, [seriesColors, seriesDashArrays]);

  // Memoized dot renderer - only recreate when colors change
  const dotRenderers = React.useMemo(() => {
    return Object.fromEntries(
      seriesKeys.map((key) => [
        key,
        (props: DotProps) => {
          if (props.cx === undefined || props.cy === undefined) return null;
          if (props.payload[key] === 0) return null;
          const color = seriesColors[key];
          const r = CHART_VISUAL_CONSTANTS.ACTIVE_DOT_RADIUS;
          if (key === 'conversations_continued') {
            const tr = r * 1.4;
            return (
              <polygon
                key={`${key}-${props.index}`}
                points={`${props.cx},${props.cy - tr} ${props.cx + tr * 0.866},${props.cy + tr * 0.5} ${props.cx - tr * 0.866},${props.cy + tr * 0.5}`}
                fill={color}
              />
            );
          }
          return (
            <circle
              key={`${key}-${props.index}`}
              cx={props.cx}
              cy={props.cy}
              r={r}
              fill={color}
            />
          );
        },
      ])
    );
  }, [seriesKeys, seriesColors]);

  // Memoized active dot renderer (shown on hover)
  const activeDotRenderers = React.useMemo(() => {
    return Object.fromEntries(
      seriesKeys.map((key) => [
        key,
        (props: DotProps) => {
          if (props.cx === undefined || props.cy === undefined) return null;
          const color = seriesColors[key];
          const r = CHART_VISUAL_CONSTANTS.ACTIVE_DOT_RADIUS + 3;
          const haloR = r * 1.8;
          if (key === 'conversations_continued') {
            const tr = r * 1.4;
            return (
              <g>
                <circle cx={props.cx} cy={props.cy} r={haloR} fill={color} fillOpacity={0.2} />
                <polygon
                  points={`${props.cx},${props.cy - tr} ${props.cx + tr * 0.866},${props.cy + tr * 0.5} ${props.cx - tr * 0.866},${props.cy + tr * 0.5}`}
                  fill={color}
                />
              </g>
            );
          }
          return (
            <g>
              <circle cx={props.cx} cy={props.cy} r={haloR} fill={color} fillOpacity={0.2} />
              <circle cx={props.cx} cy={props.cy} r={r} fill={color} />
            </g>
          );
        },
      ])
    );
  }, [seriesKeys, seriesColors]);

  // Memoized tooltip formatter
  const tooltipFormatter = React.useCallback((value: number | string | readonly (string | number)[] | undefined, key: string | number | undefined) => {
    if (typeof value !== 'number' || typeof key !== 'string') return null;
    return renderTooltipRow(key, seriesColors[key], <>{intl.formatNumber(value)} {seriesLabels[key]}</>, seriesIndicators[key] ?? '⬤');
  }, [intl, seriesColors, seriesIndicators, seriesLabels]);

  if (isPending) {
    return null;
  }

  // The series is zero-filled, so a hub with no conversations still gets a bucket a day: read the
  // counts rather than the length of the series.
  if (!chartData.some(row => (row.conversations_total as number) > 0)) {
    const { from, to } = rollingWeeks(MONTH_WEEKS);

    return (
      <ExpandedWidget.Empty
        actions={
          <Button
            label={
              <FormattedMessage
                id="global.conversations"
                defaultMessage="Conversations"
                description="Reusable label for Conversations page or list title"
              />
            }
            size="small"
            themeMode
            onClick={() => navigate(hubPath('/conversations/audience'))}
          />
        }
        icon="unanswered_question"
        title={
          <FormattedMessage
            id="lineChart.title"
            defaultMessage="Daily end-user conversations: {from} – {to}"
            description="Dashboard line chart period"
            values={{
              from: dateFormatters.formatDay(from),
              to: dateFormatters.formatDay(to),
            }}
          />
        }
        onClose={onClose}
        onSendToTop={onSendToTop}
      >
        <FormattedMessage
          id="lineChart.noConversations"
          defaultMessage="Your audience has not started a conversation in this period."
          description="Message shown when the chart has no conversations to plot"
        />
      </ExpandedWidget.Empty>
    );
  }

  const displayedStartDate = chartData[brushRange.startIndex]?.day as string;
  const displayedEndDate = chartData[brushRange.endIndex]?.day as string;
  const visibleTickCount = brushRange.endIndex - brushRange.startIndex + 1;

  return (
    <ExpandedWidget
      className={styles.lineChart}
      onClose={onClose}
      onSendToTop={onSendToTop}
      title={displayedStartDate && displayedEndDate && (
        <FormattedMessage
          id="lineChart.title"
          defaultMessage="Daily end-user conversations: {from} – {to}"
          description="Dashboard line chart period"
          values={{
            from: dateFormatters.formatDay(displayedStartDate),
            to: dateFormatters.formatDay(displayedEndDate),
          }}
        />
      )}
    >
        <StatsPanel
          startDate={displayedStartDate}
          endDate={displayedEndDate}
        />
        {seriesKeys.length > 0 && (
          <div className={styles.legend}>
            {seriesKeys.map((key) => (
              <Button
                className={clsx(hiddenSeries.has(key) && styles.legendItemHidden)}
                iconLeft={renderLegendIcon(key)}
                key={key}
                label={seriesLabels[key]}
                size="small"
                themeMode
                variant="text"
                onClick={() => toggleSeries(key)}
              />
            ))}
          </div>
        )}
        <div className={styles.lineChartContainer}>
          <RechartsLineChart data={chartData} syncId="conversationChart" responsive margin={CHART_VISUAL_CONSTANTS.MARGINS} width="100%" height={CHART_HEIGHT} className={styles.lineChartWrapper}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-color-chart)"
            />
            <XAxis
              dataKey="day"
              height={AXIS_HEIGHT}
              tickMargin={18}
              tickLine={{ stroke: 'var(--border-color-chart)' }}
              tick={(props) => (
                <CustomXAxisTick
                  {...props}
                  visibleTicksCount={visibleTickCount}
                  formatter={dateFormatters.formatDayShort}
                />
              )}
            />
            <YAxis
              width={CHART_VISUAL_CONSTANTS.AXIS_WIDTH}
              domain={[0, calculateYAxisDomain]}
              tick={CHART_VISUAL_CONSTANTS.AXIS_TICK}
              tickLine={{ stroke: 'var(--border-color-chart)' }}
              stroke="transparent"
            />
            <Tooltip
              labelFormatter={(label) => dateFormatters.formatDay(label as string)}
              contentStyle={TOOLTIP_STYLES.CONTENT}
              itemStyle={TOOLTIP_STYLES.ITEM}
              labelStyle={TOOLTIP_STYLES.LABEL}
              formatter={tooltipFormatter}
            />
            {seriesKeys.map((k) => (
              <Line
                key={k}
                type="linear"
                dataKey={k}
                name={k}
                stroke={seriesColors[k]}
                strokeWidth={CHART_VISUAL_CONSTANTS.STROKE_WIDTH}
                hide={hiddenSeries.has(k)}
                strokeDasharray={seriesDashArrays[k]}
                dot={dotRenderers[k]}
                activeDot={activeDotRenderers[k]}
                isAnimationActive
              />
            ))}
          </RechartsLineChart>
          <ContextChart
            data={chartData}
            brushRange={brushRange}
            onRangeChange={handleRangeChange}
            formatDayShort={dateFormatters.formatDayShort}
          />
        </div>
    </ExpandedWidget>
  );
}

export default LineChart;
