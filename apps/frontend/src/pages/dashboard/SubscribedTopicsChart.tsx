import { useMemo, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from "react-router";
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';

import { CHART_VISUAL_CONSTANTS, formatDay, TOOLTIP_STYLES } from '@helpers/chart';
import { rollingWeeks, SERIES_WEEKS } from '@helpers/dashboardWidgets';
import type { SubscribedTopicPoint, Waiting } from '@helpers/subscribedTopics';
import { bySubscribers, toSubscribedTopicPoints, waitingBand } from '@helpers/subscribedTopics';
import type { Tercile } from '@helpers/terciles';
import { inBand, tercileBand, tercileBounds } from '@helpers/terciles';

import { useSession } from '@root/SessionContext';

import { useHubPath } from "@hooks/useHubPath";

import Button from '@ui-components/input/Button';
import { Select, SelectItem } from '@ui-components/input/SelectInput';
import { ExpandedWidget } from '@ui-components/layout/ExpandedWidget';

import { subscribedTopicsQuery } from './subscribedTopicsQuery';

const CHART_HEIGHT = 260;

// The selects open on these, and a topic is a gap when it falls inside both — so on open the
// orange dots are exactly the ones inside the highlighted box. Deliberately broader than the
// collapsed card's rule: this asks where content might be worth adding, rather than naming the
// one topic the card recommends.
const DEFAULT_AUDIENCE: Tercile = 'top';
const DEFAULT_WAITING: Waiting = 'months';

const COLORS = {
  gap: 'var(--color-orange-59)',
  covered: 'var(--color-green-68)',
} as const;

type Coverage = keyof typeof COLORS;

// Already carries its own alpha, so it needs no fillOpacity of its own
const HIGHLIGHT_COLOR = 'var(--color-orange-10)';

const SubscribedTopicsChart = ({ onClose, onSendToTop }: {
  onClose?: () => void,
  onSendToTop?: () => void,
}) => {
  const hubId = useSession().currentHubId();
  const intl = useIntl();
  const navigate = useNavigate();
  const hubPath = useHubPath();

  const [audienceTercile, setAudienceTercile] = useState<Tercile>(DEFAULT_AUDIENCE);
  const [waiting, setWaiting] = useState<Waiting>(DEFAULT_WAITING);

  const { from, to } = useMemo(() => rollingWeeks(SERIES_WEEKS), []);

  const { data, isPending } = useQuery({
    ...subscribedTopicsQuery(hubId),
    enabled: Boolean(hubId),
  });

  const points = useMemo(() => toSubscribedTopicPoints(data?.subscribed_topics ?? []), [data]);
  // A zero-wide axis has no scale, and a hub can genuinely have every topic up to date
  const maxSubscribers = useMemo(() => Math.max(1, ...points.map(point => point.subscribers)), [points]);
  const maxWeeks = useMemo(() => Math.max(1, ...points.map(point => point.weeks)), [points]);
  const subscriberBounds = useMemo(() => tercileBounds(maxSubscribers), [maxSubscribers]);

  const ranked = useMemo(() => [...points].sort(bySubscribers), [points]);

  // Fixed, so the colours stay put as the reader moves the selects around
  const gapAudience = tercileBand(DEFAULT_AUDIENCE, subscriberBounds, maxSubscribers);
  const gapWeeks = waitingBand(DEFAULT_WAITING, maxWeeks);

  const coverageOf = (point: SubscribedTopicPoint): Coverage =>
    inBand(point.subscribers, gapAudience) && inBand(point.weeks, gapWeeks) ? 'gap' : 'covered';

  if (isPending) return null;


  const title = (
    <FormattedMessage
      id="subscribedTopicsChart.title"
      defaultMessage="Topic subscribers waiting for new content: {from} – {to}"
      description="Title of the expanded subscribed topics chart, with the period it covers"
      values={{ from: formatDay(from, intl), to: formatDay(to, intl) }}
    />
  );

  if (points.length === 0) {
    return (
      <ExpandedWidget.Empty
        actions={
          <Button
            label={
              <FormattedMessage
                id="global.dataSources"
                defaultMessage="Data sources"
                description="Reusable label for Data Sources page or list title"
              />
            }
            size="small"
            themeMode
            onClick={() => navigate(hubPath('/data-sources'))}
          />
        }
        icon="bell_slash"
        title={title}
        onClose={onClose}
        onSendToTop={onSendToTop}
      >
        <FormattedMessage
          id="subscribedTopicsChart.noSubscribers"
          defaultMessage="Your audience has not subscribed to a topic yet."
          description="Message shown when the chart has no subscribed topics to plot"
        />
      </ExpandedWidget.Empty>
    );
  }

  const grouped: Record<Coverage, SubscribedTopicPoint[]> = {
    gap: points.filter(point => coverageOf(point) === 'gap'),
    covered: points.filter(point => coverageOf(point) === 'covered'),
  };

  const subscriberBand = tercileBand(audienceTercile, subscriberBounds, maxSubscribers);
  const weeksBand = waitingBand(waiting, maxWeeks);
  const weeksLabel = intl.formatMessage({ id: 'subscribedTopicsChart.weeksSince', defaultMessage: 'Weeks since new document added', description: 'Horizontal axis label of the subscribed topics chart' });
  const subscribersLabel = intl.formatMessage({ id: 'subscribedTopicsChart.subscribers', defaultMessage: 'Subscribers', description: 'Vertical axis label of the subscribed topics chart' });

  const audienceOptions: { value: Tercile, label: React.ReactNode }[] = [
    {
      value: 'bottom',
      label: <FormattedMessage id="subscribedTopicsChart.fewSubscribers" defaultMessage="few subscribers (bottom 3rd)" description="Filter option for the topics with the fewest subscribers" />,
    },
    {
      value: 'middle',
      label: <FormattedMessage id="subscribedTopicsChart.someSubscribers" defaultMessage="some subscribers (middle 3rd)" description="Filter option for topics with a middling number of subscribers" />,
    },
    {
      value: 'top',
      label: <FormattedMessage id="subscribedTopicsChart.bigAudience" defaultMessage="big audience (top 3rd)" description="Filter option for the topics with the most subscribers" />,
    },
  ];

  const waitingOptions: { value: Waiting, label: React.ReactNode }[] = [
    {
      value: 'weeks',
      label: <FormattedMessage id="subscribedTopicsChart.waitingForWeeks" defaultMessage="waiting for weeks" description="Filter option for topics whose subscribers have waited weeks for a document" />,
    },
    {
      value: 'months',
      label: <FormattedMessage id="subscribedTopicsChart.waitingForMonths" defaultMessage="waiting for months" description="Filter option for topics whose subscribers have waited months for a document" />,
    },
  ];

  const legend: { coverage: Coverage, label: React.ReactNode }[] = [
    {
      coverage: 'gap',
      label: <FormattedMessage id="subscribedTopicsChart.gapToFill" defaultMessage="Gap to fill" description="Chart legend for topics with many subscribers that have gone months without a new document" />,
    },
    {
      coverage: 'covered',
      label: <FormattedMessage id="subscribedTopicsChart.covered" defaultMessage="Covered" description="Chart legend for subscribed topics whose audience is not underserved, having few subscribers or a recent document" />,
    },
  ];

  return (
    <ExpandedWidget
      title={title}
      onClose={onClose}
      onSendToTop={onSendToTop}
      style={{ '--chart-height': `${CHART_HEIGHT}px` } as React.CSSProperties}
    >
      <ExpandedWidget.Columns>
        <ExpandedWidget.Column>
          <ExpandedWidget.Filters>
            <FormattedMessage
              id="global.lastWeeks"
              defaultMessage="{weeks, plural, one {Last # week} other {Last # weeks}}"
              description="Label for the period a dashboard chart covers"
              tagName="span"
              values={{ weeks: SERIES_WEEKS }}
            />
            <ExpandedWidget.Separator />
            <Select
              size="small"
              value={audienceTercile}
              onValueChange={(value: string) => setAudienceTercile(value as Tercile)}
            >
              {audienceOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </Select>
            <ExpandedWidget.Separator />
            <Select
              size="small"
              value={waiting}
              onValueChange={(value: string) => setWaiting(value as Waiting)}
            >
              {waitingOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </Select>
          </ExpandedWidget.Filters>

          <ExpandedWidget.Plot
            top={
              <>
                <FormattedMessage
                  id="subscribedTopicsChart.recentlyAddedManySubscribers"
                  defaultMessage="recently added • many subscribers"
                  description="Label for the chart corner holding topics with many subscribers and a recent document"
                  tagName="span"
                />
                <FormattedMessage
                  id="subscribedTopicsChart.quietManySubscribers"
                  defaultMessage="quiet topic • many subscribers"
                  description="Label for the chart corner holding topics with many subscribers and no recent document"
                  tagName="span"
                />
              </>
            }
            bottom={
              <>
                <FormattedMessage
                  id="subscribedTopicsChart.recentlyAddedFewSubscribers"
                  defaultMessage="recently added • few subscribers"
                  description="Label for the chart corner holding topics with few subscribers and a recent document"
                  tagName="span"
                />
                <FormattedMessage
                  id="subscribedTopicsChart.quietFewSubscribers"
                  defaultMessage="quiet topic • few subscribers"
                  description="Label for the chart corner holding topics with few subscribers and no recent document"
                  tagName="span"
                />
              </>
            }
            axisLabel={weeksLabel}
          >
            <ScatterChart
              responsive
              width="100%"
              height={CHART_HEIGHT}
              margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color-chart)" />
              <XAxis
                type="number"
                dataKey="weeks"
                height={CHART_VISUAL_CONSTANTS.AXIS_TICK_ROOM}
                domain={[0, maxWeeks]}
                name={weeksLabel}
                tick={{ fill: 'var(--text-color-secondary)' }}
                tickLine={{ stroke: 'var(--border-color-chart)' }}
                stroke="transparent"
              />
              <YAxis
                type="number"
                dataKey="subscribers"
                width={CHART_VISUAL_CONSTANTS.AXIS_WIDTH}
                domain={[0, maxSubscribers]}
                name={subscribersLabel}
                label={{ value: subscribersLabel, angle: -90, position: 'insideLeft', fill: 'var(--text-color-secondary)' }}
                tick={{ fill: 'var(--text-color-secondary)' }}
                tickLine={{ stroke: 'var(--border-color-chart)' }}
                stroke="transparent"
              />
              <ReferenceArea
                x1={weeksBand[0]}
                x2={weeksBand[1]}
                y1={subscriberBand[0]}
                y2={subscriberBand[1]}
                fill={HIGHLIGHT_COLOR}
                stroke="none"
              />
              {weeksBand
                .filter(edge => edge > 0 && edge < maxWeeks)
                .map(edge => (
                  <ReferenceLine key={`x-${edge}`} x={edge} stroke={COLORS.gap} strokeDasharray="4 4" />
                ))}
              {subscriberBand
                .filter(edge => edge > 0 && edge < maxSubscribers)
                .map(edge => (
                  <ReferenceLine key={`y-${edge}`} y={edge} stroke={COLORS.gap} strokeDasharray="4 4" />
                ))}
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={TOOLTIP_STYLES.CONTENT}
                itemStyle={TOOLTIP_STYLES.ITEM}
                labelStyle={TOOLTIP_STYLES.LABEL}
                content={({ payload }) => {
                  const point = payload?.[0]?.payload as SubscribedTopicPoint | undefined;
                  if (!point) return null;
                  return (
                    <ExpandedWidget.Tooltip color={COLORS[coverageOf(point)]} title={point.name}>
                      <FormattedMessage
                        id="subscribedTopicsChart.subscribersCount"
                        defaultMessage="{subscribers, plural, one {# subscriber} other {# subscribers}}"
                        description="Number of end-users subscribed to a topic"
                        tagName="li"
                        values={{ subscribers: point.subscribers }}
                      />
                      <FormattedMessage
                        id="subscribedTopicsChart.weeksSilent"
                        defaultMessage="{weeks, plural, one {# week silent} other {# weeks silent}}"
                        description="How many weeks a topic has gone without a new document"
                        tagName="li"
                        values={{ weeks: point.weeks }}
                      />
                    </ExpandedWidget.Tooltip>
                  );
                }}
              />
              {legend.map(({ coverage }) => (
                <Scatter
                  key={coverage}
                  data={grouped[coverage]}
                  fill={COLORS[coverage]}
                  isAnimationActive={false}
                />
              ))}
            </ScatterChart>
          </ExpandedWidget.Plot>

          <ExpandedWidget.Legend
            items={legend.map(({ coverage, label }) => ({ key: coverage, color: COLORS[coverage], label }))}
          />
        </ExpandedWidget.Column>

        <ExpandedWidget.Column tableContainer>
          <ExpandedWidget.Table>
            <thead>
              <tr>
                <th colSpan={2}>
                  <FormattedMessage
                    id="subscribedTopicsChart.waitingAudiences"
                    defaultMessage="Waiting audiences, most subscribers first"
                    description="Title of the table ranking subscribed topics by how many people are waiting for new content"
                    tagName="h4"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(point => (
                <ExpandedWidget.Row key={point.id} name={point.name}>
                  <FormattedMessage
                    id="subscribedTopicsChart.subscribersCount"
                    defaultMessage="{subscribers, plural, one {# subscriber} other {# subscribers}}"
                    description="Number of end-users subscribed to a topic"
                    values={{ subscribers: point.subscribers }}
                  />
                  <ExpandedWidget.Separator />
                  <FormattedMessage
                    id="subscribedTopicsChart.weeksSilentShort"
                    defaultMessage="{weeks, plural, one {# wk silent} other {# wks silent}}"
                    description="Abbreviated number of weeks a topic has gone without a new document"
                    values={{ weeks: point.weeks }}
                  />
                </ExpandedWidget.Row>
              ))}
            </tbody>
          </ExpandedWidget.Table>
        </ExpandedWidget.Column>
      </ExpandedWidget.Columns>
    </ExpandedWidget>
  );
};

export default SubscribedTopicsChart;
