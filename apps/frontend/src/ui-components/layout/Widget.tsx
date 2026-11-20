import clsx from 'clsx';
import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { Bar, BarChart, Line, LineChart, ReferenceLine } from 'recharts';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import styles from './Widget.module.css';

const messages = defineMessages({
  expandToShowDetails: {
    id: 'global.expandToShowDetails',
    defaultMessage: 'Expand to show details',
    description: 'Generic open details panel button label',
  },
  hideWidget: {
    id: 'global.hideWidget',
    defaultMessage: 'Hide this widget',
    description: 'Tooltip for the button that removes a dashboard widget from view',
  },
});

type WidgetProps = {
  children: React.ReactNode;
  className?: string;
};

export const Widget = ({ children, className }: WidgetProps) => (
  <div className={clsx([styles.widget], [className])}>
    {children}
  </div>
);

type TitleProps = {
  title: React.ReactNode;
  onExpand?: () => void;
  onHide?: () => void;
};

const WidgetTitle = ({ title, onExpand, onHide }: TitleProps) => {
  const intl = useIntl();

  return (
    <hgroup className={styles.widgetTitle}>
      <h3>{title}</h3>
      { (onExpand || onHide) &&
        <div className={styles.widgetTitleActions}>
          { onHide &&
            <Button
              title={intl.formatMessage(messages.hideWidget)}
              iconLeft={<Icon aria-hidden id="eye_closed" />}
              onClick={onHide}
              size="small"
              themeMode
              variant="text"
            />
          }
          { onExpand &&
            <Button
              title={intl.formatMessage(messages.expandToShowDetails)}
              iconLeft={<Icon aria-hidden id="arrows_out" />}
              onClick={onExpand}
              size="small"
              themeMode
            />
          }
        </div>
      }
    </hgroup>
  );
};

Widget.Title = WidgetTitle;

type HeadlineProps = {
  title: React.ReactNode;
  context?: React.ReactNode;
};

const WidgetHeadline = ({ title, context }: HeadlineProps) => (
  <hgroup className={styles.widgetHeadline}>
    <h2>{title}</h2>
    {context && <span>{context}</span>}
  </hgroup>
);

Widget.Headline = WidgetHeadline;

type BodyProps = {
  children: React.ReactNode;
  className?: string;
};

const WidgetBody = ({ children, className }: BodyProps) => (
  <div className={clsx([styles.widgetBody], [className])}>
    {children}
  </div>
);

Widget.Body = WidgetBody;

type SparkLineProps = {
  color?: TrendColor,
  data: SparkLineData,
  referenceValue?: number,
  noData?: boolean,
};

// Passed to the chart and to the CSS box around it. Measuring instead reads -1 when the trend
// mounts before its parent has been laid out, which recharts warns about and draws nothing for.
const SPARK_LINE_WIDTH = 80;
const SPARK_LINE_HEIGHT = 20;

const CHART_COLORS: Record<TrendColor, string> = {
  green: 'var(--text-color-trusted)',
  red: 'var(--text-color-error)',
  neutral: 'var(--border-color-chart)',
};

const WidgetSparkLine = ({
  color,
  data,
  referenceValue,
  noData = false,
}: SparkLineProps) => {
  return (
    <div
      className={styles.widgetSparkLine}
      style={{
        '--spark-line-width': `${SPARK_LINE_WIDTH}px`,
        '--spark-line-height': `${SPARK_LINE_HEIGHT}px`,
      } as React.CSSProperties}
    >
      <LineChart data={data} width={SPARK_LINE_WIDTH} height={SPARK_LINE_HEIGHT}>
        <Line
          activeDot={false}
          type="monotone"
          dataKey="value"
          stroke={noData || !color ? 'transparent' : CHART_COLORS[color]}
          strokeWidth={2}
          dot={
            noData || !color ?
              false :
              (({ cx, cy, index }) => index === data.length - 1 ? (<circle cx={cx} cy={cy} r={4} fill={CHART_COLORS[color]} />) : null)
          }
        />
        { referenceValue !== undefined &&
          <ReferenceLine
            y={referenceValue}
            stroke="var(--border-color-chart)"
            strokeDasharray="4 4"
          />
        }
      </LineChart>
    </div>
  );
}

Widget.SparkLine = WidgetSparkLine;

type HistogramProps = {
  color?: TrendColor,
  data: SparkLineData,
};

const WidgetHistogram = ({ color, data }: HistogramProps) => (
  <div
    className={styles.widgetHistogram}
    style={{
      '--spark-line-width': `${SPARK_LINE_WIDTH}px`,
      '--spark-line-height': `${SPARK_LINE_HEIGHT}px`,
    } as React.CSSProperties}
  >
    <BarChart data={data} width={SPARK_LINE_WIDTH} height={SPARK_LINE_HEIGHT} barCategoryGap={1}>
      <Bar dataKey="value" fill={color ? CHART_COLORS[color] : 'transparent'} isAnimationActive={false} />
      <ReferenceLine y={0} stroke="var(--border-color-chart)" strokeDasharray="4 4" />
    </BarChart>
  </div>
);

Widget.Histogram = WidgetHistogram;

export type TrendColor = 'green' | 'red' | 'neutral';

export type TrendDirection = 'up' | 'down' | 'nochange';

export type SparkLineData = { value: number, date?: string }[];

export type TrendDateRange = { from: string, to: string };

type TrendProps = {
  color?: TrendColor,
  data: SparkLineData,
  dateRange?: TrendDateRange,
  direction?: TrendDirection,
  label: React.ReactNode,
  referenceValue?: number,
  noData?: boolean,
};

const WidgetTrend = ({
  color,
  data,
  dateRange,
  direction,
  label,
  referenceValue,
  noData = false,
}: TrendProps) => {
  const trendLabel = noData ? null : label && (
    <div className={styles.trendLabel}>
      {direction !== 'nochange' && <Icon id={`arrow_${direction}`} />}
      {label}
    </div>
  );

  return (
    <div className={clsx(styles.widgetTrend, {
      [styles.green]: color === "green",
      [styles.red]: color === "red",
      [styles.neutral]: color === "neutral",
    })}>
      {trendLabel && dateRange ? (
        <Tooltip
          content={
            <FormattedMessage
              id="global.widgetTrendDateRange"
              defaultMessage="{from} – {to}"
              description="Date range covered by a dashboard widget’s trend, shown in a tooltip. Example: Aug 28, 2026 – Sep 4, 2026"
              values={{
                from: <FormattedDate key="from" value={dateRange.from} month="short" day="numeric" year="numeric" timeZone="UTC" />,
                to: <FormattedDate key="to" value={dateRange.to} month="short" day="numeric" year="numeric" timeZone="UTC" />,
              }}
            />
          }
        >
          {trendLabel}
        </Tooltip>
      ) : trendLabel}
      <WidgetSparkLine
        color={color}
        data={data}
        referenceValue={referenceValue}
        noData={noData}
      />
    </div>
  );
};

Widget.Trend = WidgetTrend;

type FooterProps = {
  label: React.ReactNode;
  onClick: () => void;
};

const WidgetFooter = ({ label, onClick }: FooterProps) => (
  <div className={styles.widgetFooter}>
    <Button
      iconRight={<Icon aria-hidden id="chevron_right" className="icon-flip-rtl" />}
      label={label}
      size="small"
      variant="text"
      themeMode
      onClick={onClick}
    />
  </div>
);

Widget.Footer = WidgetFooter;
