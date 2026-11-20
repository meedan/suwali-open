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
import { MONTH_WEEKS, rollingWeeks } from '@helpers/dashboardWidgets';
import type { Tercile } from '@helpers/terciles';
import { inTercile, tercileBand, tercileBounds } from '@helpers/terciles';
import type { TopicPoint } from '@helpers/topics';
import { asksPerDocument, byGapSeverity, toTopicPoints } from '@helpers/topics';

import { useSession } from '@root/SessionContext';

import { useHubPath } from "@hooks/useHubPath";

import Button from '@ui-components/input/Button';
import { Select, SelectItem } from '@ui-components/input/SelectInput';
import { ExpandedWidget } from '@ui-components/layout/ExpandedWidget';

import { topicsQuery } from './topicsQuery';

const CHART_HEIGHT = 260;

const COLORS = {
  gap: 'var(--color-orange-59)',
  covered: 'var(--color-positive)',
  rarelyAsked: 'var(--text-color-secondary)',
} as const;

type Coverage = keyof typeof COLORS;

const HIGHLIGHT_COLOR = 'var(--color-orange-10)';


const TopicsChart = ({ onClose, onSendToTop }: {
  onClose?: () => void,
  onSendToTop?: () => void,
}) => {
  const hubId = useSession().currentHubId();
  const intl = useIntl();
  const navigate = useNavigate();
  const hubPath = useHubPath();

  const [documentsTercile, setDocumentsTercile] = useState<Tercile>('bottom');
  const [asksTercile, setAsksTercile] = useState<Tercile>('top');

  const { from, to } = useMemo(() => rollingWeeks(MONTH_WEEKS), []);

  const { data, isPending } = useQuery({
    ...topicsQuery(hubId),
    enabled: Boolean(hubId),
  });

  const points = useMemo(() => toTopicPoints(data?.top_topics ?? []), [data]);
  // A hub can genuinely have no qualifying documents at all, and a zero-wide axis has no scale
  const maxAsks = useMemo(() => Math.max(1, ...points.map(point => point.asks)), [points]);
  const maxDocuments = useMemo(() => Math.max(1, ...points.map(point => point.documents)), [points]);
  const askBounds = useMemo(() => tercileBounds(maxAsks), [maxAsks]);
  const documentBounds = useMemo(() => tercileBounds(maxDocuments), [maxDocuments]);

  // Always the gap quadrant, never the selected one: the selects move the highlight, but a topic's
  // colour states whether it is a gap, which does not depend on what the reader is looking at.
  const coverageOf = (point: TopicPoint): Coverage => {
    const oftenAsked = inTercile(point.asks, 'top', askBounds);
    if (oftenAsked && inTercile(point.documents, 'bottom', documentBounds)) return 'gap';
    return oftenAsked ? 'covered' : 'rarelyAsked';
  };

  const ranked = useMemo(() => [...points].sort(byGapSeverity), [points]);

  if (isPending) return null;


  const title = (
    <FormattedMessage
      id="topicsChart.title"
      defaultMessage="Conversation topics versus document coverage: {from} – {to}"
      description="Title of the expanded conversation topics chart, with the period it covers"
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
        icon="bookmark"
        title={title}
        onClose={onClose}
        onSendToTop={onSendToTop}
      >
        <FormattedMessage
          id="topicsChart.noTopics"
          defaultMessage="Your audience has not asked about any topics in this period."
          description="Message shown when the chart has no topics to plot"
        />
      </ExpandedWidget.Empty>
    );
  }

  const grouped: Record<Coverage, TopicPoint[]> = {
    gap: points.filter(point => coverageOf(point) === 'gap'),
    covered: points.filter(point => coverageOf(point) === 'covered'),
    rarelyAsked: points.filter(point => coverageOf(point) === 'rarelyAsked'),
  };

  const askBand = tercileBand(asksTercile, askBounds, maxAsks);
  const documentBand = tercileBand(documentsTercile, documentBounds, maxDocuments);
  const documentsLabel = intl.formatMessage({ id: 'topicsChart.documents', defaultMessage: 'Documents', description: 'Horizontal axis label of the topics chart' });
  const asksLabel = intl.formatMessage({ id: 'topicsChart.asks', defaultMessage: 'Asks', description: 'Vertical axis label of the topics chart' });

  const tercileOptions: { value: Tercile, documents: React.ReactNode, asks: React.ReactNode }[] = [
    {
      value: 'bottom',
      documents: <FormattedMessage id="topicsChart.fewDocuments" defaultMessage="few documents (bottom 3rd)" description="Filter option for topics with the fewest documents" />,
      asks: <FormattedMessage id="topicsChart.rarelyAsked" defaultMessage="rarely asked (bottom 3rd)" description="Filter option for the least asked about topics" />,
    },
    {
      value: 'middle',
      documents: <FormattedMessage id="topicsChart.someDocuments" defaultMessage="some documents (middle 3rd)" description="Filter option for topics with a middling number of documents" />,
      asks: <FormattedMessage id="topicsChart.sometimesAsked" defaultMessage="sometimes asked (middle 3rd)" description="Filter option for topics asked about a middling amount" />,
    },
    {
      value: 'top',
      documents: <FormattedMessage id="topicsChart.manyDocuments" defaultMessage="many documents (top 3rd)" description="Filter option for topics with the most documents" />,
      asks: <FormattedMessage id="topicsChart.oftenAsked" defaultMessage="often asked (top 3rd)" description="Filter option for the most asked about topics" />,
    },
  ];

  const legend: { coverage: Coverage, label: React.ReactNode }[] = [
    {
      coverage: 'gap',
      label: <FormattedMessage id="topicsChart.gapToFill" defaultMessage="Gap to fill" description="Chart legend for topics asked about often with few documents behind them" />,
    },
    {
      coverage: 'covered',
      label: <FormattedMessage id="topicsChart.covered" defaultMessage="Covered" description="Chart legend for topics asked about often with enough documents behind them" />,
    },
    {
      coverage: 'rarelyAsked',
      label: <FormattedMessage id="topicsChart.coveredRarelyAsked" defaultMessage="Covered, rarely asked" description="Chart legend for topics that are not asked about often" />,
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
              values={{ weeks: MONTH_WEEKS }}
            />
            <ExpandedWidget.Separator />
            <Select
              size="small"
              value={documentsTercile}
              onValueChange={(value: string) => setDocumentsTercile(value as Tercile)}
            >
              {tercileOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.documents}</SelectItem>
              ))}
            </Select>
            <ExpandedWidget.Separator />
            <Select
              size="small"
              value={asksTercile}
              onValueChange={(value: string) => setAsksTercile(value as Tercile)}
            >
              {tercileOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.asks}</SelectItem>
              ))}
            </Select>
          </ExpandedWidget.Filters>

          <ExpandedWidget.Plot
            top={
              <>
                <FormattedMessage
                  id="topicsChart.fewDocsOftenAsked"
                  defaultMessage="few docs • often asked"
                  description="Label for the chart corner holding topics asked about often with few documents"
                  tagName="span"
                />
                <FormattedMessage
                  id="topicsChart.manyDocsOftenAsked"
                  defaultMessage="many docs • often asked"
                  description="Label for the chart corner holding topics asked about often with many documents"
                  tagName="span"
                />
              </>
            }
            bottom={
              <>
                <FormattedMessage
                  id="topicsChart.fewDocsRarelyAsked"
                  defaultMessage="few docs • rarely asked"
                  description="Label for the chart corner holding topics rarely asked about with few documents"
                  tagName="span"
                />
                <FormattedMessage
                  id="topicsChart.manyDocsRarelyAsked"
                  defaultMessage="many docs • rarely asked"
                  description="Label for the chart corner holding topics rarely asked about with many documents"
                  tagName="span"
                />
              </>
            }
            axisLabel={documentsLabel}
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
                dataKey="documents"
                height={CHART_VISUAL_CONSTANTS.AXIS_TICK_ROOM}
                domain={[0, maxDocuments]}
                name={documentsLabel}
                tick={{ fill: 'var(--text-color-secondary)' }}
                tickLine={{ stroke: 'var(--border-color-chart)' }}
                stroke="transparent"
              />
              <YAxis
                type="number"
                dataKey="asks"
                width={CHART_VISUAL_CONSTANTS.AXIS_WIDTH}
                domain={[0, maxAsks]}
                name={asksLabel}
                label={{ value: asksLabel, angle: -90, position: 'insideLeft', fill: 'var(--text-color-secondary)' }}
                tick={{ fill: 'var(--text-color-secondary)' }}
                tickLine={{ stroke: 'var(--border-color-chart)' }}
                stroke="transparent"
              />
              <ReferenceArea
                x1={documentBand[0]}
                x2={documentBand[1]}
                y1={askBand[0]}
                y2={askBand[1]}
                fill={HIGHLIGHT_COLOR}
                stroke="none"
              />
              {documentBand
                .filter(edge => edge > 0 && edge < maxDocuments)
                .map(edge => (
                  <ReferenceLine key={`x-${edge}`} x={edge} stroke={COLORS.gap} strokeDasharray="4 4" />
                ))}
              {askBand
                .filter(edge => edge > 0 && edge < maxAsks)
                .map(edge => (
                  <ReferenceLine key={`y-${edge}`} y={edge} stroke={COLORS.gap} strokeDasharray="4 4" />
                ))}
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={TOOLTIP_STYLES.CONTENT}
                itemStyle={TOOLTIP_STYLES.ITEM}
                labelStyle={TOOLTIP_STYLES.LABEL}
                content={({ payload }) => {
                  const point = payload?.[0]?.payload as TopicPoint | undefined;
                  if (!point) return null;
                  return (
                    <ExpandedWidget.Tooltip color={COLORS[coverageOf(point)]} title={point.name}>
                      <FormattedMessage
                        id="topicsChart.asksCount"
                        defaultMessage="{asks, plural, one {# ask} other {# asks}}"
                        description="Number of questions asked about a topic"
                        tagName="li"
                        values={{ asks: point.asks }}
                      />
                      <FormattedMessage
                        id="topicsChart.documentsCount"
                        defaultMessage="{documents, plural, one {# document} other {# documents}}"
                        description="Number of documents that answered questions about a topic"
                        tagName="li"
                        values={{ documents: point.documents }}
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
                    id="topicsChart.mostAsksPerDocument"
                    defaultMessage="Most topic asks per document"
                    description="Title of the table ranking topics by how many questions each document answers"
                    tagName="h4"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(point => (
                <ExpandedWidget.Row key={point.id} name={point.name}>
                  <FormattedMessage
                    id="topicsChart.asksCount"
                    defaultMessage="{asks, plural, one {# ask} other {# asks}}"
                    description="Number of questions asked about a topic"
                    values={{ asks: point.asks }}
                  />
                  <ExpandedWidget.Separator />
                  <FormattedMessage
                    id="topicsChart.documentsCountShort"
                    defaultMessage="{documents, plural, one {# doc} other {# docs}}"
                    description="Abbreviated number of documents that answered questions about a topic"
                    values={{ documents: point.documents }}
                  />
                  <ExpandedWidget.Separator />
                  <FormattedMessage
                    id="topicsChart.perDocument"
                    defaultMessage="{ratio} / doc"
                    description="How many questions each document about a topic answered"
                    values={{ ratio: point.documents === 0 ? '-' : asksPerDocument(point) }}
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

export default TopicsChart;
