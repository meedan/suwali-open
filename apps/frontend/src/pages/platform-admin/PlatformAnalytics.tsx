import clsx from 'clsx';
import type { ReactNode } from 'react';
import { defineMessages, FormattedMessage, FormattedNumber, useIntl } from 'react-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';

import { CHART_VISUAL_CONSTANTS, formatDay, formatDayShort, makeCountTooltipFormatter, TOOLTIP_STYLES } from '@helpers/chart';

import type { MessageState } from '@services/AdminService';
import { fetchPlatformStatistics } from '@services/AdminService';

import type { LegendItem } from '@ui-components/layout/Legend';
import ChartLegend from '@ui-components/layout/Legend';

import HubsByCreationDateChart from '@components/HubsByCreationDateChart';
import QuestionsByAnsweredChart from '@components/QuestionsByAnsweredChart';

import adminStyles from './PlatformAdmin.module.css';
import styles from './PlatformAnalytics.module.css';

const messages = defineMessages({
  syncStatusComplete: {
    id: 'admin.syncStatusComplete',
    defaultMessage: 'Complete',
    description: 'Sync status complete label in documents chart legend',
  },
  syncStatusPending: {
    id: 'admin.syncStatusPending',
    defaultMessage: 'Pending',
    description: 'Sync status pending label in documents chart legend',
  },
  syncStatusError: {
    id: 'admin.syncStatusError',
    defaultMessage: 'Error',
    description: 'Sync status error label in documents chart legend',
  },
  stateUserMessage: {
    id: 'admin.stateUserMessage',
    defaultMessage: 'User message',
    description: 'Message state label for user_message in chart legend',
  },
  stateBotMessage: {
    id: 'admin.stateBotMessage',
    defaultMessage: 'Bot message',
    description: 'Message state label for bot_message in chart legend',
  },
  stateBotProcessing: {
    id: 'admin.stateBotProcessing',
    defaultMessage: 'Bot processing',
    description: 'Message state label for bot_processing in chart legend',
  },
  stateBotIntermediaryMessage: {
    id: 'admin.stateBotIntermediaryMessage',
    defaultMessage: 'Bot intermediary',
    description: 'Message state label for bot_intermediary_message in chart legend',
  },
  stateUserContributionStarted: {
    id: 'admin.stateUserContributionStarted',
    defaultMessage: 'Contribution started (user)',
    description: 'Message state label for user_contribution_started in chart legend',
  },
  stateBotContributionStarted: {
    id: 'admin.stateBotContributionStarted',
    defaultMessage: 'Contribution started (bot)',
    description: 'Message state label for bot_contribution_started in chart legend',
  },
  stateUserContributionSubmitted: {
    id: 'admin.stateUserContributionSubmitted',
    defaultMessage: 'Contribution submitted (user)',
    description: 'Message state label for user_contribution_submitted in chart legend',
  },
  stateBotContributionSubmitted: {
    id: 'admin.stateBotContributionSubmitted',
    defaultMessage: 'Contribution submitted (bot)',
    description: 'Message state label for bot_contribution_submitted in chart legend',
  },
  stateUserContributionCancelled: {
    id: 'admin.stateUserContributionCancelled',
    defaultMessage: 'Contribution canceled (user)',
    description: 'Message state label for user_contribution_cancelled in chart legend',
  },
  stateBotContributionCancelled: {
    id: 'admin.stateBotContributionCancelled',
    defaultMessage: 'Contribution canceled (bot)',
    description: 'Message state label for bot_contribution_cancelled in chart legend',
  },
  stateContribution: {
    id: 'admin.stateContribution',
    defaultMessage: 'Contribution',
    description: 'Chart legend entry grouping all contribution-related message states together, to keep the legend short — the exact sub-state is still available on hover',
  },
  stateClosedWindow: {
    id: 'admin.stateClosedWindow',
    defaultMessage: 'Closed window',
    description: 'Message state label for closed_window in chart legend',
  },
  stateUnsupportedMessage: {
    id: 'admin.stateUnsupportedMessage',
    defaultMessage: 'Unsupported message',
    description: 'Message state label for unsupported_message in chart legend',
  },
  stateKnowledgeServiceError: {
    id: 'admin.stateKnowledgeServiceError',
    defaultMessage: 'Knowledge service error',
    description: 'Message state label for knowledge_service_error in chart legend',
  },
  stateRateLimitReached: {
    id: 'admin.stateRateLimitReached',
    defaultMessage: 'Rate limit reached',
    description: 'Message state label for rate_limit_reached in chart legend',
  },
  avgTimeFaster: {
    id: 'admin.avgTimeFaster',
    defaultMessage: 'faster',
    description: 'Label indicating answer time decreased compared to another period',
  },
  avgTimeSlower: {
    id: 'admin.avgTimeSlower',
    defaultMessage: 'slower',
    description: 'Label indicating answer time increased compared to another period',
  },
});

const CHART_HEIGHT = 400;

const SYNC_STATUS_COLORS = {
  complete: 'var(--color-purple-67)',
  pending: 'var(--color-yellow-38)',
  error: 'var(--color-pink-53)',
};

const MESSAGE_STATES: MessageState[] = [
  'user_message',
  'bot_processing',
  'bot_intermediary_message',
  'bot_message',
  'user_contribution_started',
  'bot_contribution_started',
  'user_contribution_cancelled',
  'bot_contribution_cancelled',
  'user_contribution_submitted',
  'bot_contribution_submitted',
  'closed_window',
  'unsupported_message',
  'knowledge_service_error',
  'rate_limit_reached',
];

// 6 evenly-spaced lightness steps across the orange hue (hsl 25°) for all contribution states
const CONTRIBUTION_SHADES = [30, 38, 47, 56, 65, 73].map((l) => `hsl(25deg 85% ${l}%)`);
const [
  contribUserStarted,
  contribBotStarted,
  contribUserSubmitted,
  contribBotSubmitted,
  contribUserCancelled,
  contribBotCancelled,
] = CONTRIBUTION_SHADES;

// These six keep their own bar color (still visible in the stack and on hover), but share one
// legend entry — six near-identical shades in the legend is more noise than signal.
const CONTRIBUTION_STATES: MessageState[] = [
  'user_contribution_started',
  'bot_contribution_started',
  'user_contribution_submitted',
  'bot_contribution_submitted',
  'user_contribution_cancelled',
  'bot_contribution_cancelled',
];
const CONTRIBUTION_LEGEND_COLOR = contribUserSubmitted;

const MESSAGE_STATE_COLORS: Record<MessageState, string> = {
  // Matches conversation flow (fromUser / fromBot / processing / closedWindow)
  user_message: 'var(--color-purple-67)',
  bot_message: 'var(--color-black-8)',
  bot_processing: 'var(--color-gray-50)',
  bot_intermediary_message: 'var(--color-gray-50)',
  closed_window: 'var(--color-gray-75)',
  // Contribution states: 6 orange shades, dark→light
  user_contribution_started: contribUserStarted,
  bot_contribution_started: contribBotStarted,
  user_contribution_submitted: contribUserSubmitted,
  bot_contribution_submitted: contribBotSubmitted,
  user_contribution_cancelled: contribUserCancelled,
  bot_contribution_cancelled: contribBotCancelled,
  // Errors: three pink shades (pink-53 → pink-80 → pink-85)
  knowledge_service_error: 'var(--color-pink-53)',
  rate_limit_reached: 'var(--color-pink-80)',
  unsupported_message: 'var(--color-pink-85)',
};

const PlatformAnalytics = () => {
  const intl = useIntl();

  const { data } = useQuery({
    queryKey: ['/admin/statistics'],
    queryFn: () => fetchPlatformStatistics({ group_by: 'week' }),
    staleTime: 5 * 60 * 1000,
  });

  const formatMs = (ms: number | null | undefined) =>
    ms != null ? `${(ms / 1000).toFixed(1)}s` : '—';

  const formatDelta = (current: number | null | undefined, comparison: number | null | undefined) => {
    if (current == null || comparison == null || comparison === 0) return null;
    const diffMs = comparison - current; // positive = current is faster
    if (diffMs === 0) return null;
    const pct = Math.round(Math.abs(diffMs / comparison) * 100);
    const absDiffS = (Math.abs(diffMs) / 1000).toFixed(1);
    const faster = diffMs > 0;
    return {
      text: `${faster ? '↓' : '↑'}${absDiffS}s (${pct}% ${intl.formatMessage(faster ? messages.avgTimeFaster : messages.avgTimeSlower)})`,
      comparisonText: formatMs(comparison),
      faster,
    };
  };

  const avgTimes = data?.average_answer_times;

  const messageStateLabels: Record<MessageState, string> = {
    user_message: intl.formatMessage(messages.stateUserMessage),
    bot_message: intl.formatMessage(messages.stateBotMessage),
    bot_processing: intl.formatMessage(messages.stateBotProcessing),
    bot_intermediary_message: intl.formatMessage(messages.stateBotIntermediaryMessage),
    user_contribution_started: intl.formatMessage(messages.stateUserContributionStarted),
    bot_contribution_started: intl.formatMessage(messages.stateBotContributionStarted),
    user_contribution_submitted: intl.formatMessage(messages.stateUserContributionSubmitted),
    bot_contribution_submitted: intl.formatMessage(messages.stateBotContributionSubmitted),
    user_contribution_cancelled: intl.formatMessage(messages.stateUserContributionCancelled),
    bot_contribution_cancelled: intl.formatMessage(messages.stateBotContributionCancelled),
    closed_window: intl.formatMessage(messages.stateClosedWindow),
    unsupported_message: intl.formatMessage(messages.stateUnsupportedMessage),
    knowledge_service_error: intl.formatMessage(messages.stateKnowledgeServiceError),
    rate_limit_reached: intl.formatMessage(messages.stateRateLimitReached),
  };

  // Collapses the six contribution sub-states into a single "Contribution" legend entry — each
  // still keeps its own bar color in the stack and its own name in the hover tooltip, so no detail
  // is actually lost, just kept out of the always-visible legend.
  const buildMessageLegendItems = (payload: readonly { dataKey?: unknown, color?: string, value?: unknown }[] | undefined): LegendItem[] => {
    const items: LegendItem[] = [];
    let contributionAdded = false;
    (payload ?? []).forEach((entry) => {
      const key = String(entry.dataKey);
      if (CONTRIBUTION_STATES.includes(key as MessageState)) {
        if (!contributionAdded) {
          items.push({ key: 'contribution', color: CONTRIBUTION_LEGEND_COLOR, label: intl.formatMessage(messages.stateContribution) });
          contributionAdded = true;
        }
        return;
      }
      items.push({ key, color: entry.color ?? '', label: entry.value as ReactNode });
    });
    return items;
  };

  return (
    <section id="analytics">
      <FormattedMessage
        id="admin.analyticsTitle"
        defaultMessage="Active hub analytics ({count})"
        description="Title for the platform analytics section in the admin dashboard, showing the number of currently active hubs the analytics below cover"
        values={{ count: data?.global_counts?.hubs ?? 0 }}
        tagName="h2"
      />
      <dl className={adminStyles.statsRow}>
        <div className={clsx(adminStyles.statCard, styles.avgTimeCard)}>
          <div>
            <FormattedMessage
              id="admin.avgTime"
              defaultMessage="Avg. answer time"
              description="Label for average answer time stat card"
              tagName="dt"
            />
            <dd>
              {formatMs(avgTimes?.last_week)}
              <FormattedMessage
                id="admin.pastWeek"
                defaultMessage="past week"
                description="Period label for the past week of average response time"
                tagName="small"
              />
              <div className={styles.avgTimeDeltas}>
                {(() => {
                  const d = formatDelta(avgTimes?.last_week, avgTimes?.last_month);
                  return d && (
                    <span className={d.faster ? styles.deltaFaster : styles.deltaSlower} title={d.comparisonText}>
                      <strong>{d.text}</strong>{' '}
                      <FormattedMessage
                        id="admin.avgTimePeriodLastMonth"
                        defaultMessage="past month"
                        description="Period label for last-month average response time"
                      />
                    </span>
                  );
                })()}
                {(() => {
                  const d = formatDelta(avgTimes?.last_week, avgTimes?.all_time);
                  return d && (
                    <span className={d.faster ? styles.deltaFaster : styles.deltaSlower} title={d.comparisonText}>
                      <strong>{d.text}</strong>{' '}
                      <FormattedMessage
                        id="admin.avgTimePeriodAllTime"
                        defaultMessage="all time"
                        description="Period label for all-time average response time"
                      />
                    </span>
                  );
                })()}
              </div>
            </dd>
          </div>
        </div>
        {([
          {
            key: 'users',
            label: <FormattedMessage id="admin.statUsers" defaultMessage="Users" description="Label for Users count stat" />,
            value: data?.global_counts?.users,
          },
          {
            key: 'conversations',
            label: <FormattedMessage id="admin.statConversations" defaultMessage="Conversations" description="Label for Conversations count stat" />,
            value: data?.global_counts?.conversations,
          },
          {
            key: 'external_users',
            label: <FormattedMessage id="admin.statExternalUsers" defaultMessage="End-users" description="Label for end users count stat" />,
            value: data?.global_counts?.external_users,
          },
          {
            key: 'messages',
            label: <FormattedMessage id="admin.statMessages" defaultMessage="Messages" description="Label for Messages count stat" />,
            value: data?.global_counts?.messages,
          },
          {
            key: 'sources',
            label: <FormattedMessage id="admin.statSources" defaultMessage="Sources" description="Label for Sources count stat" />,
            value: data?.global_counts?.sources,
          },
          {
            key: 'documents',
            label: <FormattedMessage id="admin.statDocuments" defaultMessage="Documents" description="Label for Documents count stat" />,
            value: data?.global_counts?.documents,
          },
        ]).map(({ key, label, value }) => (
          <div key={key} className={adminStyles.statCard}>
            <dt>{label}</dt>
            <dd>
              {value != null ? <FormattedNumber value={value} /> : '—'}
            </dd>
          </div>
        ))}
      </dl>
      <div className={styles.chartsGrid}>
        <div className={styles.chartPanel}>
          <FormattedMessage
            id="admin.documentsChartTitle"
            defaultMessage="Documents added per week (by sync status)"
            description="Title for the documents by week stacked bar chart in the admin dashboard"
            tagName="h3"
          />
          <BarChart
            data={data?.documents_by_sync_status ?? []}
            height={CHART_HEIGHT}
            margin={CHART_VISUAL_CONSTANTS.MARGINS}
            responsive
            width="100%"
          >
            <CartesianGrid vertical={false} stroke="var(--border-color-chart)" />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => formatDayShort(value, intl)}
              tick={{ fill: 'var(--text-color-secondary)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'var(--text-color-secondary)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={CHART_VISUAL_CONSTANTS.AXIS_WIDTH}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLES.CONTENT}
              itemStyle={TOOLTIP_STYLES.ITEM}
              labelStyle={TOOLTIP_STYLES.LABEL}
              labelFormatter={(value) => formatDay(value, intl)}
              formatter={makeCountTooltipFormatter(SYNC_STATUS_COLORS, intl)}
              wrapperStyle={{ zIndex: 10 }}
              cursor={false}
            />
            <Legend
              align="left"
              wrapperStyle={{ paddingLeft: `${CHART_VISUAL_CONSTANTS.AXIS_WIDTH}px` }}
              content={({ payload }) => (
                <ChartLegend
                  className={styles.chartLegend}
                  items={(payload ?? []).map(entry => ({
                    key: String(entry.dataKey),
                    color: entry.color ?? '',
                    label: entry.value,
                  }))}
                />
              )}
            />
            <Bar dataKey="complete" stackId="a" fill={SYNC_STATUS_COLORS.complete} background={false} name={intl.formatMessage(messages.syncStatusComplete)} />
            <Bar dataKey="pending" stackId="a" fill={SYNC_STATUS_COLORS.pending} background={false} name={intl.formatMessage(messages.syncStatusPending)} />
            <Bar dataKey="error" stackId="a" fill={SYNC_STATUS_COLORS.error} background={false} name={intl.formatMessage(messages.syncStatusError)} />
          </BarChart>
        </div>
        <div className={styles.chartPanel}>
          <FormattedMessage
            id="admin.messagesChartTitle"
            defaultMessage="Messages per week (by state)"
            description="Title for the messages by week stacked bar chart in the admin dashboard"
            tagName="h3"
          />
          <BarChart
            data={data?.messages_by_state ?? []}
            height={CHART_HEIGHT}
            margin={CHART_VISUAL_CONSTANTS.MARGINS}
            responsive
            width="100%"
          >
            <CartesianGrid vertical={false} stroke="var(--border-color-chart)" />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => formatDayShort(value, intl)}
              tick={{ fill: 'var(--text-color-secondary)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'var(--text-color-secondary)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={CHART_VISUAL_CONSTANTS.AXIS_WIDTH}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLES.CONTENT}
              itemStyle={TOOLTIP_STYLES.ITEM}
              labelStyle={TOOLTIP_STYLES.LABEL}
              labelFormatter={(value) => formatDay(value, intl)}
              formatter={makeCountTooltipFormatter(MESSAGE_STATE_COLORS, intl)}
              wrapperStyle={{ zIndex: 10 }}
              cursor={false}
            />
            <Legend
              align="left"
              wrapperStyle={{ paddingLeft: `${CHART_VISUAL_CONSTANTS.AXIS_WIDTH}px` }}
              content={({ payload }) => (
                <ChartLegend className={styles.chartLegend} items={buildMessageLegendItems(payload)} />
              )}
            />
            {MESSAGE_STATES.map((state) => (
              <Bar key={state} dataKey={state} stackId="a" fill={MESSAGE_STATE_COLORS[state]} background={false} name={messageStateLabels[state]} />
            ))}
          </BarChart>
        </div>
        <div className={styles.chartPanel}>
          <FormattedMessage
            id="admin.answeredQuestionsChartTitle"
            defaultMessage="Questions per week (answered vs unanswered)"
            description="Title for the answered vs unanswered questions stacked bar chart in the admin dashboard"
            tagName="h3"
          />
          <QuestionsByAnsweredChart data={data?.questions_by_answered ?? []} height={CHART_HEIGHT} />
        </div>
        <div className={styles.chartPanel}>
          <FormattedMessage
            id="admin.hubsByCreationDateChartTitle"
            defaultMessage="Hubs created per week (active vs deleted)"
            description="Title for the hubs-created-per-week stacked bar chart in the admin dashboard"
            tagName="h3"
          />
          <HubsByCreationDateChart data={data?.hubs_by_creation_date ?? []} height={CHART_HEIGHT} />
        </div>
      </div>
    </section>
  );
};

export default PlatformAnalytics;
