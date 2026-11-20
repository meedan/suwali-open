import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { NavLink } from 'react-router'
import { useQuery } from '@tanstack/react-query';

import { fetchStatistics } from "@services/HubService";

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';

import HintBox from '@ui-components/layout/HintBox';
import Icon from "@ui-components/layout/Icon";

import styles from './StatsPanel.module.css';

const messages = defineMessages({
  conversations: {
    id: 'global.endUserConversations',
    defaultMessage: 'End-user conversations',
    description: 'Reusable label for end-user conversations page or list title',
  },
});

interface StatsPanelProps {
  startDate: string;
  endDate: string;
}

export default function StatsPanel({
  startDate,
  endDate,
}: StatsPanelProps) {
  const intl = useIntl();
  const hubId = useSession().currentHubId();
  const hubPath = useHubPath();

  const { data, isPending } = useQuery({
    queryKey: [`/hubs/${hubId}/statistics`, startDate, endDate],
    queryFn: () => fetchStatistics({
      hubId: hubId!,
      fields: ['total_conversations', 'unique_end_users', 'average_timeout_window_interval', 'average_timeout_window_message_count'],
      from: startDate,
      to: endDate,
    }),
    enabled: Boolean(hubId && startDate && endDate),
  });

  let total = 0;
  let totalEndUsers = 0;
  let avgDurationSeconds = 0;
  let avgDurationMinutes = 0;
  let avgMessageCount = 0;
  const conversationLink = `/conversations/audience?has_message=${startDate},${endDate}`;

  if (!isPending && data) {
    total = data.total_conversations || 0;
    totalEndUsers = data.unique_end_users || 0;
    avgDurationSeconds = data.average_timeout_window_interval || 0;
    avgDurationMinutes = Math.ceil(avgDurationSeconds / 60);
    avgMessageCount = Math.ceil(data.average_timeout_window_message_count || 0);
  }

  return (
    <>
      <div className={styles.statsPanelLink}>
        <NavLink key="endUsersCountLink" to={hubPath(conversationLink)} title={intl.formatMessage(messages.conversations)}>
          <FormattedMessage
            id="statsPanel.endUsersInChart"
            defaultMessage="View conversations in selected range"
            description="Link text to take the user from the line chart to the conversations with end users that appear in the chart"
            tagName="span"
          />
          <Icon id="chevron_right" aria-hidden />
        </NavLink>
      </div>
      <div className={styles.statsPanel}>
        <HintBox
          className={styles.hintBox}
          title={
            <FormattedMessage
              id="global.totalConversations"
              defaultMessage="Total conversations"
              description="Reusable title for total number of conversations shown."
            />
          }
          body={total}
          type="themeMode"
          noIcon
        />
        <HintBox
          className={styles.hintBox}
          title={
            <FormattedMessage
              id="global.endUsers"
              defaultMessage="End-users"
              description="Reusable label for end users from messaging platforms."
            />
          }
          body={totalEndUsers}
          type="themeMode"
          noIcon
        />
        <HintBox
          className={styles.hintBox}
          title={
            <FormattedMessage
              id="statsPanel.avgDuration"
              defaultMessage="Average duration"
              description="Average duration of conversation windows title."
            />
          }
          body={
            <FormattedMessage
              id="statsPanel.avgDurationValue"
              defaultMessage="{count, plural, =0 {0 mins} one {1 min} other {{count} mins}}"
              description="Average duration of conversation windows in minutes."
              values={{ count: avgDurationMinutes }}
            />
          }
          type="themeMode"
          noIcon
        />
        <HintBox
          className={styles.hintBox}
          title={
            <FormattedMessage
              id="statsPanel.avgEndUserMessages"
              defaultMessage="Average end-user messages"
              description="Title for the average number of end user messages per conversation window."
            />
          }
          body={avgMessageCount}
          type="themeMode"
          noIcon
        />
      </div>
    </>
  );
}
