import clsx from "clsx";
import { FormattedMessage } from "react-intl";
import * as Sentry from '@sentry/react';
import { Handle, Position } from "@xyflow/react";

import type { Message, MessageState } from '@customTypes/message';

import { useMessageHighlight } from "@contexts/MessageSelectContext";

import { useFlowDirection } from "@hooks/useFlowDirection";

import Icon from "@ui-components/layout/Icon";
import { Popover, PopoverContent, PopoverTrigger } from "@ui-components/layout/Popover";

import styles from './FlowNode.module.css';
import BotMessage from "./node-content/BotMessage";
import ClosedWindow from "./node-content/ClosedWindow";
import ContributionMessage from "./node-content/ContributionMessage";
import DataSourceItems from "./node-content/DataSourceItems";
import KnowledgeServiceError from "./node-content/KnowledgeServiceError";
import nodeContentStyles from './node-content/NodeContent.module.css';
import RateLimitReached from "./node-content/RateLimitReached";
import SystemNotice from "./node-content/SystemNotice";
import SystemProcessing from "./node-content/SystemProcessing";
import UserMessage from "./node-content/UserMessage";

type SyntheticMessageNodeType = 'contribution_processing';

type MessageNodeType =
  MessageState |
  SyntheticMessageNodeType;

type MessageNodeIcon =
  MessageNodeType |
  'bot_bad_question' |
  'bot_no_data_source_items'|
  'bot_with_data_source_items';

type MessageNodeProps = {
  data: {
    id: Message['id'],
    body: Message['body'],
    type: MessageNodeType,
    isFirst: boolean,
    isLast: boolean,
    hasBranch: boolean,
    hasContributionExit?: boolean,
    metadata: Message['metadata'],
    dataSourceItems: Message['data_source_items'],
    dataSourceItemsCount: Message['data_source_items_count'],
    topics: Message['topic_names'],
    messageObject: Message,
  },
}

const ICON_MAP: Partial<Record<MessageNodeIcon, React.ReactNode>> = {
  bot_message: <Icon id="bot" />,
  bot_bad_question: <Icon id="question_mark" />,
  bot_no_data_source_items: <Icon id="document_dashed" />,
  bot_with_data_source_items: <Icon id="bot" />,
  user_message: <Icon id="user" />,
  bot_processing: <Icon id="lightning" />,
  bot_intermediary_message: <Icon id="lightning" />,
  bot_welcome_message: <Icon id="bot" />,
  contribution_processing: <Icon id="lightning" />,
  user_contribution_started: <Icon id="hand_waving" />,
  bot_contribution_cancelled: <Icon id="x" />,
  bot_contribution_submitted: <Icon id="check" />,
  closed_window: <Icon id="countdown" />,
  rate_limit_reached: <Icon id="countdown" />,
  knowledge_service_error: <Icon id="error" />,
  topic_notification: <Icon id="megaphone" />,
  topic_notification_sources: <Icon id="document" />,
  subscription_confirmed: <Icon id="check" />,
  unsubscription_confirmed: <Icon id="x" />,
  interaction_see_sources: <Icon id="document" />,
  unsupported_message: <Icon id="error" />,
  non_question_reply: <Icon id="bot" />,
};

const SEND_LABEL = (
  <FormattedMessage
    id="messageNode.directionSend"
    defaultMessage="Send"
    description="Label that represents an outbound message in a conversation"
  />
);

const ACTION_LABELS_MAP: Partial<Record<MessageNodeType, React.ReactNode>> = {
  bot_message: SEND_LABEL,
  user_message: (
    <FormattedMessage
      id="messageNode.directionReceive"
      defaultMessage="Receive"
      description="Label that represents an inbound generic message in a conversation"
    />
  ),
  bot_processing: '',
  bot_intermediary_message: '',
  contribution_processing: '',
  user_contribution_started: (
    <FormattedMessage
      id="messageNode.contributionInitiate"
      defaultMessage="Initiate"
      description="Label for contribution started action"
    />
  ),
  bot_contribution_cancelled: (
    <FormattedMessage
      id="messageNode.contributionCancel"
      defaultMessage="Cancel"
      description="Label for contribution cancelled action"
    />
  ),
  bot_contribution_submitted: (
    <FormattedMessage
      id="messageNode.contributionSubmit"
      defaultMessage="Submit"
      description="Label for contribution submitted action"
    />
  ),
  closed_window: (
    <FormattedMessage
      id="messageNode.closedWindow"
      defaultMessage="Close"
      description="Label for closed conversation window due to inactivity"
    />
  ),
  rate_limit_reached: (
    <FormattedMessage
      id="messageNode.rateLimitReached"
      defaultMessage="Block"
      description="Label for rate limit reached"
    />
  ),
  knowledge_service_error: SEND_LABEL,
  topic_notification: SEND_LABEL,
  topic_notification_sources: SEND_LABEL,
  subscription_confirmed: SEND_LABEL,
  unsubscription_confirmed: SEND_LABEL,
  bot_welcome_message: SEND_LABEL,
  interaction_see_sources: SEND_LABEL,
  unsupported_message: SEND_LABEL,
  non_question_reply: SEND_LABEL,
};

const USER_MESSAGE_TITLE = (
  <FormattedMessage
    id="global.userMessage"
    defaultMessage="End-user message"
    description="Reusable label that represents a message originated from the User"
  />
);

const BOT_MESSAGE_TITLE = (
  <FormattedMessage
    id="global.botMessage"
    defaultMessage="Chatbot message"
    description="Reusable label that represents a message originated from the Bot"
  />
);

const CONTRIBUTION_TITLE = (
  <FormattedMessage
    id="global.contributionMessage"
    defaultMessage="Contribution"
    description="Label that represents a contribution message"
  />
);

const notifySentry = (message: string, data: MessageNodeProps['data']) => {
  Sentry.captureMessage(
    message,
    {
      extra: {
        messageId: data.messageObject?.id,
        messageState: data.messageObject?.state,
        nodeType: data.type,
      },
      level: 'info',
    },
  );
};

const getBotMessageState = (data: MessageNodeProps['data']) => {
  if (data.messageObject?.direction !== 'outgoing') return null;

  if (
    data.type === 'knowledge_service_error' &&
    data.metadata.error_type === 'NO_ANSWER_AVAILABLE'
  ) {
    return 'noAnswerAvailable';
  }

  // Bail if bot_processing, closed_window, etc
  if (data.type !== 'bot_message') return null;

  const dataSourceItemsCount = data.dataSourceItemsCount;

  if (dataSourceItemsCount === undefined) return 'badQuestion';

  if (
    dataSourceItemsCount === 0 &&
    data.metadata.router_intent === 'question'
  ) {
    return 'noDataSourceItem';
  }

  return 'withDataSourceItems';
};

const getIcon = (data: MessageNodeProps['data'], botState: string | null) => {
  if (botState === 'badQuestion') return ICON_MAP.bot_bad_question;
  if (botState === 'noDataSourceItem' || botState === 'noAnswerAvailable') return ICON_MAP.bot_no_data_source_items;
  if (botState === 'withDataSourceItems') return ICON_MAP.bot_with_data_source_items;

  let icon = ICON_MAP[data.type];

  if (!icon) {
    const messageDirection = data.messageObject?.direction;
    icon = messageDirection === 'outgoing' ?
      ICON_MAP['bot_message'] :
      ICON_MAP['user_message'];

    notifySentry('[MessageNode]: getIcon(): using fallback value', data);
  }
  return icon;
};

const getNodeContent = (data: MessageNodeProps['data']) => {
  const NODE_CONTENT_MAP: Partial<Record<MessageNodeType, React.ReactNode>> = {
    bot_message: <BotMessage message={data.messageObject!} />,
    user_message: <UserMessage message={data.messageObject!} body={data.body} topics={data.topics} contextUpdates={data.metadata?.context_updates} />,
    bot_processing: <SystemProcessing message={data.messageObject!} body={data.body} metadata={data.metadata} />,
    bot_intermediary_message: <SystemProcessing message={data.messageObject!} body={data.body} metadata={data.metadata} />,
    contribution_processing: <SystemProcessing message={data.messageObject!} body={data.body} metadata={data.metadata} />,
    user_contribution_started: <ContributionMessage message={data.messageObject!} body={data.body} type="started" origin="user" />,
    bot_contribution_cancelled: <ContributionMessage message={data.messageObject!} body={data.body} type="cancelled" origin="bot" />,
    bot_contribution_submitted: <ContributionMessage message={data.messageObject!} body={data.body} type="submitted" origin="bot" />,
    closed_window: <ClosedWindow message={data.messageObject!} body={data.body} />,
    rate_limit_reached: <RateLimitReached message={data.messageObject!} body={data.body} />,
    knowledge_service_error: getBotMessageState(data) === 'noAnswerAvailable' ?
      <BotMessage message={data.messageObject!} /> :
      <KnowledgeServiceError message={data.messageObject!} body={data.body} messageId={data.id} metadata={data.metadata} />,
    topic_notification: (
      <>
        <SystemNotice
          message={data.messageObject!}
          iconId="megaphone"
          body={data.body}
          title={
            <FormattedMessage
              id="messageNode.topicNotificationDetailTitle"
              defaultMessage="Topic notification"
              description="Popover title for a notification sent to subscribers about new content in a topic"
              tagName="span"
            />
          }
        />
        {data.dataSourceItemsCount > 0 &&
          <DataSourceItems
            dataSourceItems={data.dataSourceItems}
            title={
              <FormattedMessage
                id="messageNode.topicNotificationDocuments"
                defaultMessage="{count, plural, one {# document} other {# documents}} in this notification"
                description="Header for the list of documents a topic notification was sent about"
                tagName="span"
                values={{ count: data.dataSourceItems.length }}
              />
            }
          />
        }
      </>
    ),
    topic_notification_sources: (
      <SystemNotice
        message={data.messageObject!}
        iconId="document"
        body={data.body}
        title={
          <FormattedMessage
            id="messageNode.topicNotificationSourcesDetailTitle"
            defaultMessage="Notification sources"
            description="Popover title for the sources sent after a user taps See More on a topic notification"
            tagName="span"
          />
        }
      />
    ),
    subscription_confirmed: (
      <SystemNotice
        message={data.messageObject!}
        iconId="check"
        body={data.body}
        title={
          <FormattedMessage
            id="messageNode.subscriptionConfirmedDetailTitle"
            defaultMessage="Subscription confirmed"
            description="Popover title for the message confirming a user subscribed to topics"
            tagName="span"
          />
        }
      />
    ),
    unsubscription_confirmed: (
      <SystemNotice
        message={data.messageObject!}
        iconId="x"
        body={data.body}
        title={
          <FormattedMessage
            id="messageNode.unsubscriptionConfirmedDetailTitle"
            defaultMessage="Unsubscribe confirmed"
            description="Popover title for the message confirming a user unsubscribed from a topic"
            tagName="span"
          />
        }
      />
    ),
    bot_welcome_message: <BotMessage message={data.messageObject!} />,
    interaction_see_sources: <BotMessage message={data.messageObject!} />,
    unsupported_message: <BotMessage message={data.messageObject!} />,
    non_question_reply: <BotMessage message={data.messageObject!} />,
  };

  let nodeContent = NODE_CONTENT_MAP[data.type];

  if (!nodeContent) {
    const messageDirection = data.messageObject?.direction;
    nodeContent = messageDirection === 'outgoing' ?
      <BotMessage message={data.messageObject!} /> :
      <UserMessage message={data.messageObject!} body={data.body} topics={data.topics} contextUpdates={data.metadata?.context_updates} />;

    notifySentry('[MessageNode]: getNodeContent(): using fallback value', data);
  }
  return nodeContent;
};

const getAction = (data: MessageNodeProps['data']) => {
  let actionLabel = ACTION_LABELS_MAP[data.type];

  // Use fallback direction-based action label if undefined.
  // Intentionally empty labels should be defined as empty strings.
  if (actionLabel === undefined) {
    const messageDirection = data.messageObject?.direction;
    actionLabel ??= messageDirection === 'outgoing' ?
      ACTION_LABELS_MAP['bot_message'] :
      ACTION_LABELS_MAP['user_message'];

    notifySentry('[MessageNode]: getAction(): using fallback value', data);
  }
  return actionLabel;
};

const getTitle = (data: MessageNodeProps['data']) => {
  const getBotNodeTitle = () => {
    const dataSourceItemsCount = data.dataSourceItemsCount;

    if (dataSourceItemsCount === undefined) {
      return (
        <FormattedMessage
          id="global.messageNodetitleBotBadQuestion"
          defaultMessage="Unable to process"
          description="Label that represents a message originated from the Chatbot when data source item metadata is unavailable"
        />
      );
    }

    if (getBotMessageState(data) === 'noDataSourceItem') {
      return (
        <FormattedMessage
          id="global.messageNodetitleBotNoDataSourceItem"
          defaultMessage="No sources"
          description="Label that represents a message originated from the Chatbot with no data source items"
        />
      );
    }

    if (data.messageObject?.answered === true) {
      return (
        <FormattedMessage
          id="global.messageNodetitleBotWithDataSourceItems"
          defaultMessage="Chatbot answer"
          description="Label that represents a message originated from the Chatbot that includes data source items"
        />
      );
    }

    return BOT_MESSAGE_TITLE;
  };

  const NODE_TITLE_MAP: Partial<Record<MessageNodeType, React.ReactNode>> = {
    bot_message: getBotNodeTitle(),
    user_message: USER_MESSAGE_TITLE,
    bot_processing: '',
    bot_intermediary_message: '',
    contribution_processing: '',
    user_contribution_started: CONTRIBUTION_TITLE,
    bot_contribution_cancelled: CONTRIBUTION_TITLE,
    bot_contribution_submitted: CONTRIBUTION_TITLE,
    bot_welcome_message: (
      <FormattedMessage
        id="global.messageNodetitleBotWelcomeMessage"
        defaultMessage="Welcome message"
        description="Label that represents a message originated from the Chatbot when it is a welcome message"
      />
    ),
    closed_window: (
      <FormattedMessage
        id="global.conversation"
        defaultMessage="Conversation"
        description="Reusable label for Conversation page or title"
      />
    ),
    rate_limit_reached: (
      <FormattedMessage
        id="global.rateLimitReached"
        defaultMessage="Rate limit"
        description="Label for rate limit reached"
      />
    ),
    interaction_see_sources: (
      <FormattedMessage
        id="global.dataSources"
        defaultMessage="Data sources"
        description="Reusable label for Data Sources page or list title"
      />
    ),
    knowledge_service_error: getBotMessageState(data) === 'noAnswerAvailable' ? (
      <FormattedMessage
        id="global.noAnswerAvailable"
        defaultMessage="No answer available"
        description="Reusable label that represents a chatbot response without a conclusive answer to a question"
      />
    ) : (
      <FormattedMessage
        id="global.errorMessage"
        defaultMessage="Error message"
        description="Label that represents an error message"
      />
    ),
    topic_notification: (
      <FormattedMessage
        id="messageNode.topicNotificationTitle"
        defaultMessage="Notification"
        description="Node title for a topic notification message"
      />
    ),
    topic_notification_sources: (
      <FormattedMessage
        id="global.dataSources"
        defaultMessage="Data sources"
        description="Reusable label for Data Sources page or list title"
      />
    ),
    subscription_confirmed: (
      <FormattedMessage
        id="messageNode.subscriptionConfirmedTitle"
        defaultMessage="Subscribed"
        description="Node title for a subscription confirmation message"
      />
    ),
    unsubscription_confirmed: (
      <FormattedMessage
        id="messageNode.unsubscriptionConfirmedTitle"
        defaultMessage="Unsubscribed"
        description="Node title for an unsubscription confirmation message"
      />
    ),
    unsupported_message: (
      <FormattedMessage
        id="messageNode.unsupportedMessage"
        defaultMessage="Unsupported message"
        description="Node title for an unsupported message"
      />
    ),
    non_question_reply: BOT_MESSAGE_TITLE,
  };

  let nodeTitle = NODE_TITLE_MAP[data.type];

  // Use fallback direction-based title if undefined.
  // Intentionally empty titles should be defined as empty strings.
  if (nodeTitle === undefined) {
    const messageDirection = data.messageObject?.direction;
    nodeTitle ??= messageDirection === 'outgoing' ?
      BOT_MESSAGE_TITLE :
      USER_MESSAGE_TITLE;

    notifySentry('[MessageNode]: getTitle(): using fallback value', data);
  }
  return nodeTitle;
};

const MessageNode = ({ data }: MessageNodeProps) => {
  const { inlineEnd, popoverSide } = useFlowDirection();
  const { highlightMessageId, selectMessageHighlight } = useMessageHighlight();

  const botState = getBotMessageState(data);
  const messageDirection = data.messageObject?.direction;

  // Check if this should be styled as a chatbot message
  const isBotType = botState === 'withDataSourceItems' ||
                    data.type === 'bot_contribution_cancelled' ||
                    data.type === 'bot_contribution_submitted' ||
                    data.type === 'bot_welcome_message' ||
                    data.type === 'interaction_see_sources' ||
                    messageDirection === 'outgoing';

  // Check if this should be styled as a user message
  const isUserType =
    data.type === 'user_message' ||
    data.type === 'user_contribution_started' ||
    messageDirection === 'incoming';

  return (
    <div key={data.id} className={styles.wrapper}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={clsx([
              styles.node,
              {
                [styles.fromBot]: isBotType,
                [styles.fromBotCancelling]: data.type === 'bot_contribution_cancelled',
                [styles.fromBotBadQuestion]: botState === 'badQuestion',
                [styles.fromBotNoDataSourceItems]: botState === 'noDataSourceItem',
                [styles.fromUser]: isUserType,
                [styles.processing]: data.type === 'bot_processing' || data.type === 'bot_intermediary_message',
                [styles.contributionProcessing]: data.type === 'contribution_processing',
                [styles.closedWindow]: data.type === 'closed_window',
                [styles.rateLimitReached]: data.type === 'rate_limit_reached',
                [styles.error]: data.type === 'knowledge_service_error' || data.type === 'unsupported_message',
                [styles.topicNotification]: data.type === 'topic_notification' || data.type === 'topic_notification_sources',
                [styles.subscriptionConfirmed]: data.type === 'subscription_confirmed',
                [styles.unsubscriptionConfirmed]: data.type === 'unsubscription_confirmed',
                [styles.highlighted]: highlightMessageId === data.id,
              }
            ])}
            aria-pressed={data.id ? highlightMessageId === data.id : undefined}
            onClick={data.id ? () => selectMessageHighlight(data.id) : undefined}
          >
            { !data.isFirst &&
              <Handle
                className={styles.topTargetHandle}
                type="target"
                position={Position.Top}
              />
            }
            { data.hasBranch &&
            (
              data.type === 'user_message' ||
              data.type === 'contribution_processing'
            ) &&
              <Handle
                id="right-source"
                className={styles.rightSourceHandle}
                type="source"
                position={inlineEnd}
              />
            }
            <>
              <div className={styles.iconWrapper}>
                { getIcon(data, botState) }
              </div>
              {
                data.type !== 'bot_processing' && data.type !== 'bot_intermediary_message' && data.type !== 'contribution_processing' &&
                <div className={styles.labelWrapper}>
                  <div className={styles.actionLabel}>
                    { getAction(data) }
                  </div>
                  <div className={styles.nodeTitle}>
                    { getTitle(data) }
                  </div>
                </div>
              }
            </>
            { !data.isLast &&
              <Handle
                id="bottom-source"
                className={styles.bottomSourceHandle}
                type="source"
                position={Position.Bottom}
              />
            }
            { (
              data.hasContributionExit ||
              (data.hasBranch && data.type !== 'user_message' && data.type !== 'contribution_processing')
            ) &&
              <Handle
                id="right-target"
                className={styles.rightTargetHandle}
                type="target"
                position={inlineEnd}
              />
            }
          </button>
        </PopoverTrigger>
        <PopoverContent
          className={clsx([
            nodeContentStyles.nodeContentWrapper,
            {
              [nodeContentStyles.fromBot]: isBotType,
              [nodeContentStyles.fromUser]: isUserType,
              [nodeContentStyles.fromBotBadQuestion]: botState === 'badQuestion',
              [nodeContentStyles.processing]: data.type === 'bot_processing' || data.type === 'bot_intermediary_message',
              [nodeContentStyles.contributionProcessing]: data.type === 'contribution_processing',
              [nodeContentStyles.closedWindow]: data.type === 'closed_window',
              [nodeContentStyles.rateLimitReached]: data.type === 'rate_limit_reached',
              [nodeContentStyles.error]: data.type === 'knowledge_service_error' || data.type === 'unsupported_message',
            }
          ])}
          side={popoverSide}
        >
          { getNodeContent(data) }
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default MessageNode;
