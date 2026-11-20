import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { getTrendProps, SERIES_WEEKS } from "@helpers/dashboardWidgets";

import { useSession } from "@root/SessionContext";

import { useHubPath } from "@hooks/useHubPath";

import HintBox from "@ui-components/layout/HintBox";
import { Widget } from "@ui-components/layout/Widget";

import RequireMessagingPlatform from './RequireMessagingPlatform';
import { statisticsQuery } from './statisticsQuery';

const ConversationsWidget = ({ onExpand, onHide }: {
  onExpand?: () => void,
  onHide?: () => void,
}) => {
  const hub = useSession().currentHub();
  const hubId = hub?.id;
  const hubPath = useHubPath();
  const navigate = useNavigate();
  const { data: stats, isPending: pendingStats } = useQuery({
    ...statisticsQuery({ hubId, fields: ['number_of_new_conversations', 'number_of_continued_conversations'], groupBy: 'rolling_week', weeks: SERIES_WEEKS }),
    enabled: Boolean(hubId),
  });

  if (pendingStats) return null;

  const series = Object.entries(stats?.number_of_new_conversations ?? {}).map(([date, value]) => ({ value, date }));
  const { current: thisMonth, trend } = getTrendProps(series, 'month');

  // Both series count: a week of replies to conversations started earlier is still conversation
  // data, and the expanded chart plots them together. The headline and the sparkline stay on new
  // conversations alone, which is what this card reports.
  const hasData = [
    ...Object.values(stats?.number_of_new_conversations ?? {}),
    ...Object.values(stats?.number_of_continued_conversations ?? {}),
  ].some(value => value > 0);

  return (
    <Widget>
      <Widget.Title
        title={
          <FormattedMessage
            id="global.conversationVolume"
            defaultMessage="Conversation volume"
            description="Reusable label for the amount of conversations over a given period"
          />
        }
        onExpand={hasData ? onExpand : undefined}
        onHide={onHide}
      />
      <Widget.Headline
        title={thisMonth}
        context={
          <FormattedMessage
            id="global.newConversationsThisMonth"
            defaultMessage="{count, plural, one {New conversation this month} other {New conversations this month}}"
            description="Reusable label/title for new conversations in past month, count displayed separately"
            values={{ count: thisMonth }}
          />
        }
      />
      <RequireMessagingPlatform>
        <Widget.Body>
          <Widget.Trend {...trend} />
        </Widget.Body>
        {hasData ? (
          <Widget.Footer
            label={
              <FormattedMessage
                id="global.conversations"
                defaultMessage="Conversations"
                description="Reusable label for Conversations page or list title"
              />
            }
            onClick={() => navigate(hubPath('/conversations/audience'))}
          />
        ) : (
          <HintBox
            type="themeMode"
            body={
              <FormattedMessage
                id="conversationsWidget.noDataHint"
                defaultMessage="Conversation data from your audience on messaging platforms will appear as they become available."
                description="Hint shown when no conversation data is available"
              />
            }
          />
        )}
      </RequireMessagingPlatform>
    </Widget>
  );
};

export default ConversationsWidget;
