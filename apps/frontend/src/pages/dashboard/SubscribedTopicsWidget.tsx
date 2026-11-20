import clsx from "clsx";
import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { hasEligibleAudience, selectStaleTopic, silentWeeks } from "@helpers/subscribedTopics";

import { useSession } from "@root/SessionContext";

import { useHubPath } from "@hooks/useHubPath";

import HintBox from "@ui-components/layout/HintBox";
import Icon from "@ui-components/layout/Icon";
import { Widget } from "@ui-components/layout/Widget";

import RequireMessagingPlatform from './RequireMessagingPlatform';
import { subscribedTopicsQuery } from './subscribedTopicsQuery';
import styles from './SubscribedTopicsWidget.module.css';

const SubscribedTopicsWidget = ({ onExpand, onHide }: {
  onExpand?: () => void,
  onHide?: () => void,
}) => {
  const hubId = useSession().currentHub()?.id;
  const hubPath = useHubPath();
  const navigate = useNavigate();

  const { data: stats, isPending } = useQuery({
    ...subscribedTopicsQuery(hubId),
    enabled: Boolean(hubId),
  });

  if (isPending) return null;

  const topics = stats?.subscribed_topics ?? [];
  const topic = selectStaleTopic(topics);
  const buildingAudience = topics.length > 0 && !hasEligibleAudience(topics);
  const hasDetails = topics.length > 0 && !buildingAudience;

  return (
    <Widget>
      <Widget.Title
        title={
          <FormattedMessage
            id="global.subscribedTopics"
            defaultMessage="Subscribed topics"
            description="Reusable label for the topics your audience has subscribed to for updates"
          />
        }
        onExpand={hasDetails ? onExpand : undefined}
        onHide={onHide}
      />
      <Widget.Headline
        title={ topic ? topic.name : topics.length === 0 ? (
          <FormattedMessage
            id="subscribedTopicsWidget.noSubscriptionsYet"
            defaultMessage="No subscriptions yet"
            description="Headline shown when nobody has subscribed to any topic"
          />
        ) : buildingAudience ? (
          <FormattedMessage
            id="subscribedTopicsWidget.stillBuildingAnAudience"
            defaultMessage="Still building an audience"
            description="Headline shown when topics have subscribers, but too few to flag any of them"
          />
        ) : (
          <FormattedMessage
            id="subscribedTopicsWidget.audienceUpToDate"
            defaultMessage="Audience up to date"
            description="Headline shown when every subscribed topic has had a document added recently"
          />
        )}
        context={ topic && (
          <FormattedMessage
            id="subscribedTopicsWidget.subscribers"
            defaultMessage="{count, plural, one {# subscriber} other {# subscribers}}"
            description="Number of end-users subscribed to a topic"
            values={{ count: topic.subscribers }}
          />
        )}
      />
      <RequireMessagingPlatform>
        <Widget.Body>
          { topic ? (
            <div className={styles.status}>
              <div className={clsx(styles.statusLabel, styles.quiet)}>
                <Icon aria-hidden id="countdown_filled" />
                <FormattedMessage
                  id="subscribedTopicsWidget.weeksWithoutANewDocument"
                  defaultMessage="{weeks, selectordinal, one {#st week without a new document} two {#nd week without a new document} few {#rd week without a new document} other {#th week without a new document}}"
                  description="How long a topic has gone without a document being added for its subscribers"
                  values={{ weeks: silentWeeks(topic) }}
                />
              </div>
              <Widget.Histogram
                color="red"
                data={Object.values(topic.documents).map(value => ({ value }))}
              />
            </div>
          ) : hasDetails && (
            <div className={styles.status}>
              <div className={clsx(styles.statusLabel, styles.covered)}>
                <Icon aria-hidden id="check_filled" />
                <FormattedMessage
                  id="subscribedTopicsWidget.allTopicsCovered"
                  defaultMessage="All topics have new documents added in the past 3 months."
                  description="Status shown when no subscribed topic has gone quiet"
                />
              </div>
            </div>
          )}
          { topic ? (
            <HintBox
              iconId="lightbulb"
              type="themeMode"
              body={
                <FormattedMessage
                  id="subscribedTopicsWidget.quietTopicHint"
                  defaultMessage="Recently quiet topics with high subscribers are an opportunity to add new documents and engage the most people."
                  description="Hint explaining why a topic with many subscribers and no recent documents is worth acting on"
                />
              }
            />
          ) : topics.length === 0 ? (
            <HintBox
              iconId="info"
              type="info"
              body={
                <FormattedMessage
                  id="subscribedTopicsWidget.noSubscribersHint"
                  defaultMessage="No one has subscribed to topic updates. When they do, you’ll see which audiences are waiting to hear from you here."
                  description="Hint shown when nobody has subscribed to any topic"
                />
              }
            />
          ) : buildingAudience ? (
            <HintBox
              iconId="users"
              type="warning"
              body={
                <FormattedMessage
                  id="subscribedTopicsWidget.buildingAudienceHint"
                  defaultMessage="Not enough subscribers yet to flag underserved topics. As people subscribe, this card will surface the audiences waiting longest for new content."
                  description="Hint shown when topics have subscribers, but too few to flag any of them"
                />
              }
            />
          ) : (
            <HintBox
              iconId="check_seal"
              type="themeMode"
              body={
                <FormattedMessage
                  id="subscribedTopicsWidget.upToDateHint"
                  defaultMessage="Documents are being added covering the topics your audience has subscribed to. Expand to see details."
                  description="Hint shown when every subscribed topic has had a document added recently"
                />
              }
            />
          )}
        </Widget.Body>
        { hasDetails && (
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

export default SubscribedTopicsWidget;
