import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { getTrendProps } from "@helpers/dashboardWidgets";

import { fetchHubTrustedEndUsers } from "@services/HubService";

import { useSession } from "@root/SessionContext";

import { useHubPath } from "@hooks/useHubPath";

import HintBox from "@ui-components/layout/HintBox";
import { Widget } from "@ui-components/layout/Widget";

import { contributionsQuery } from './contributionsQuery';
import RequireMessagingPlatform from './RequireMessagingPlatform';

const ContributionsWidget = ({ onExpand, onHide }: {
  onExpand?: () => void,
  onHide?: () => void,
}) => {
  const hub = useSession().currentHub();
  const hubId = hub?.id;
  const hubPath = useHubPath();
  const navigate = useNavigate();

  const { data: stats, isPending } = useQuery({
    ...contributionsQuery(hubId),
    enabled: Boolean(hubId),
  });

  const allowlistOnly = hub?.contribution_audience === 'trusted_end_users';
  const { data: trustedEndUsers } = useQuery({
    queryKey: [`/hubs/${hubId}/external-users?trusted=true`],
    queryFn: () => fetchHubTrustedEndUsers(hubId!),
    enabled: Boolean(hubId && allowlistOnly),
  });

  if (isPending) return null;

  const series = stats?.contributions_by_contributor ?? [];
  const latest = series[series.length - 1];
  const { current: thisWeek, hasData, trend } = getTrendProps(series.map(week => ({ value: week.new + week.returning, date: week.date })), 'week');

  // Nobody can send a contribution until the allowlist has someone on it
  const allowlistEmpty = allowlistOnly && trustedEndUsers?.length === 0;

  return (
    <Widget>
      <Widget.Title
        title={
          <FormattedMessage
            id="global.communityContributions"
            defaultMessage="Community contributions"
            description="Reusable label for the tips, reports and knowledge end-users send the chatbot"
          />
        }
        onExpand={hasData ? onExpand : undefined}
        onHide={onHide}
      />
      <Widget.Headline
        title={thisWeek}
        context={
          <FormattedMessage
            id="contributionsWidget.contributionsPastWeek"
            defaultMessage="{count, plural, one {contribution in the past week} other {contributions in the past week}}"
            description="Label under the number of contributions received in the past week, count displayed separately"
            values={{ count: thisWeek }}
          />
        }
      />
      <RequireMessagingPlatform>
        <Widget.Body>
          <Widget.Trend {...trend} />
          { hasData ? (
            thisWeek > 0 && latest && (
              <HintBox
                iconId="users_source"
                type="themeMode"
                body={
                  <FormattedMessage
                    id="contributionsWidget.contributorBreakdown"
                    defaultMessage="{returning} from returning end-users and {first} from first-time contributors."
                    description="Hint splitting the past week’s contributions between end-users who had contributed before and those contributing for the first time"
                    values={{ returning: latest.returning, first: latest.new }}
                  />
                }
              />
            )
          ) : allowlistEmpty ? (
            <HintBox
              iconId="user_circle_dashed"
              type="error"
              body={
                <FormattedMessage
                  id="contributionsWidget.emptyAllowlistHint"
                  defaultMessage="Add trusted end-users to your <strong>contributions allowlist</strong>, in order to receive tips, reports, ideas, and knowledge from your audience."
                  description="Hint shown when only allowlisted end-users may contribute and the allowlist is empty"
                  values={{ strong: msg => <strong key="strong">{msg}</strong> }}
                  tagName="span"
                />
              }
            />
          ) : (
            <HintBox
              iconId="user_circle_dashed"
              type="error"
              body={
                <FormattedMessage
                  id="contributionsWidget.shareCodeHint"
                  defaultMessage="Share your contribution code <strong>{contributionCode}</strong> with your audience and receive tips, reports, ideas, and knowledge."
                  description="Hint shown when the hub can receive contributions but has not received any yet"
                  values={{
                    contributionCode: hub?.contribution_code,
                    strong: msg => <strong key="strong">{msg}</strong>,
                  }}
                  tagName="span"
                />
              }
            />
          )}
        </Widget.Body>
        { hasData ? (
          <Widget.Footer
            label={
              <FormattedMessage
                id="global.contributions"
                defaultMessage="Contributions"
                description="Reusable label for the list of end-user contributions"
              />
            }
            onClick={() => navigate(hubPath('/data-sources/contributions'))}
          />
        ) : (
          <Widget.Footer
            label={
              <FormattedMessage
                id="global.contributionWorkflow"
                defaultMessage="Contribution workflow"
                description="Reusable label for the settings deciding who can contribute and what happens to contributions"
              />
            }
            onClick={() => navigate(hubPath('/data-sources/contributions/settings'))}
          />
        )}
      </RequireMessagingPlatform>
    </Widget>
  );
};

export default ContributionsWidget;
