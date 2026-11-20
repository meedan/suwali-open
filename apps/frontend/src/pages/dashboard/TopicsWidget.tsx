import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { getTrendColor, getTrendDateRange, getTrendDirection, MONTH_WEEKS, SERIES_WEEKS } from "@helpers/dashboardWidgets";
import { selectGapTopic } from "@helpers/topics";

import type { TopTopic } from "@services/HubService";

import { useSession } from "@root/SessionContext";

import { useHubPath } from "@hooks/useHubPath";

import HintBox from "@ui-components/layout/HintBox";
import { Widget } from "@ui-components/layout/Widget";

import RequireMessagingPlatform from './RequireMessagingPlatform';
import { statisticsQuery } from './statisticsQuery';
import { TOPICS_LIMIT, topicsQuery } from './topicsQuery';


const latest = (series: Record<string, number>) => Object.values(series).pop() ?? 0;

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

// Every series covers the same buckets, so they add up position by position
const combine = (topics: TopTopic[]) => topics.reduce<number[]>(
  (totals, each) => Object.values(each.messages).map((value, index) => value + (totals[index] ?? 0)),
  []
);

const TopicsWidget = ({ onExpand, onHide }: {
  onExpand?: () => void,
  onHide?: () => void,
}) => {
  const hubId = useSession().currentHub()?.id;
  const hubPath = useHubPath();
  const navigate = useNavigate();

  const { data: stats, isPending } = useQuery({
    ...topicsQuery(hubId),
    enabled: Boolean(hubId),
  });

  // A single range bucket has no shape to draw, so the sparkline and the comparison come from a
  // weekly series over a longer window
  const { data: history, isPending: pendingHistory } = useQuery({
    ...statisticsQuery({ hubId, fields: ['top_topics'], groupBy: 'rolling_week', weeks: SERIES_WEEKS, limit: TOPICS_LIMIT }),
    enabled: Boolean(hubId),
  });

  if (isPending || pendingHistory) return null;

  const topic = selectGapTopic(stats?.top_topics ?? []);
  const asks = topic ? latest(topic.messages) : 0;
  const documents = topic ? latest(topic.data_source_items) : 0;

  // Without a top topic the line covers every topic instead, so a hub that has gone quiet still
  // sees its questions trailing off
  const messagesByBucket = topic ?
    history?.top_topics?.find(each => each.id === topic.id)?.messages :
    history?.top_topics?.[0]?.messages;
  const weekly = topic ? Object.values(messagesByBucket ?? {}) : combine(history?.top_topics ?? []);
  // Every topic's series shares the same bucket dates, so the first one describes them all
  const weeklyDates = Object.keys(messagesByBucket ?? {});
  const hasData = weekly.some(value => value > 0);
  const recent = sum(weekly.slice(-MONTH_WEEKS));
  const previous = sum(weekly.slice(-MONTH_WEEKS * 2, -MONTH_WEEKS));
  const average = weekly.length > 0 ? sum(weekly) / weekly.length : 0;
  // Flat at zero when nothing was ever asked, so the reference line still has an axis to sit on
  const points = weekly.length > 0 ? weekly : (history?.range ?? []).map(() => 0);

  return (
    <Widget>
      <Widget.Title
        title={
          <FormattedMessage
            id="global.conversationTopics"
            defaultMessage="Conversation topics"
            description="Reusable label for the topics your audience asks about"
          />
        }
        onExpand={topic ? onExpand : undefined}
        onHide={onHide}
      />
      <Widget.Headline
        title={topic ? topic.name : 0}
        context={ topic ? (
          <FormattedMessage
            id="global.asksThisMonthUsingDocuments"
            defaultMessage="{asks, plural, one {# ask} other {# asks}} this month, using {documents, plural, one {# document} other {# documents}}"
            description="Number of questions asked about a topic this month and how many documents answered them"
            values={{ asks, documents }}
          />
        ) : (
          <FormattedMessage
            id="global.asksThisMonth"
            defaultMessage="asks this month"
            description="Label under the number of questions asked about topics this month"
          />
        )}
      />
      <RequireMessagingPlatform>
        <Widget.Body>
          <Widget.Trend
            color={getTrendColor(recent, previous)}
            data={points.map(value => ({ value }))}
            dateRange={getTrendDateRange(weeklyDates, MONTH_WEEKS)}
            direction={getTrendDirection(recent, previous)}
            label={ topic && (recent === previous ? (
              <FormattedMessage
                id="global.noChangeVsLastMonth"
                defaultMessage="No change vs last month"
                description="Value comparison against different data points"
              />
            ) : (
              <FormattedMessage
                id="global.xTimesVsLastMonth"
                defaultMessage="<strong>{value, plural, one {# time} other {# times}}</strong> vs <underline>last month</underline>"
                description="Comparison between this month’s value and last month’s"
                values={{
                  value: Math.abs(recent - previous),
                  strong: msg => <strong key="strong">{msg}</strong>,
                  underline: msg => <abbr key="underline">{msg}</abbr>,
                }}
              />
            ))}
            referenceValue={average}
            noData={!hasData}
          />
          <HintBox
            iconId={topic ? 'lightbulb' : 'question'}
            type="themeMode"
            body={ topic ? (
              <FormattedMessage
                id="topicsWidget.expandCoverageHint"
                defaultMessage="Conversations around a topic with few documents may be an opportunity to expand coverage."
                description="Hint explaining what a low document count for a topic means"
              />
              ) : (
              <FormattedMessage
                id="global.noQuestionsYetHint"
                defaultMessage="Questions, both <strong>answered</strong> and <strong>unanswered</strong>, will be available when received from your audience."
                description="Hint shown when the audience has not asked any questions yet"
                values={{ strong: msg => <strong key="strong">{msg}</strong> }}
                tagName="span"
              />
            )}
          />
        </Widget.Body>
        { topic && (
            <Widget.Footer
              label={
                <FormattedMessage
                  id="global.dataSources"
                  defaultMessage="Data sources"
                  description="Reusable label for Data Sources page or list title"
                />
              }
              onClick={() => navigate(hubPath('/data-sources'))}
            />
        )}
      </RequireMessagingPlatform>
    </Widget>
  );
};

export default TopicsWidget;
