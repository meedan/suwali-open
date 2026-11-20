import { FormattedMessage } from "react-intl";

import type { Message } from "@customTypes/message";

import styles from "./NodeContent.module.css";
import NodeContentTitle from "./NodeContentTitle";
import NodeQuote from "./NodeQuote";
import TimestampField from "./TimestampField";

type ContributionMessageProps = {
  message: Message;
  body: Message['body'];
  type: 'started' | 'cancelled' | 'submitted';
  origin: 'user' | 'bot';
};

const CONTRIBUTION_TITLES = {
  started: {
    user: (
      <FormattedMessage
        id="global.userContributionStartedNodetitle"
        defaultMessage="End-user initiates contribution workflow"
        description="Label for a contribution that was started by the user"
        tagName="span"
      />
    ),
    bot: (
      <FormattedMessage
        id="global.botContributionStartedNodetitle"
        defaultMessage="Chatbot confirms contribution starting"
        description="Label for chatbot’s response to a contribution being started"
        tagName="span"
      />
    ),
  },
  cancelled: {
    user: (
      <FormattedMessage
        id="global.userContributionCancelledNodetitle"
        defaultMessage="End-user cancelled contribution"
        description="Label for a contribution that was cancelled by the user"
        tagName="span"
      />
    ),
    bot: (
      <FormattedMessage
        id="global.botContributionCancelledNodetitle"
        defaultMessage="Chatbot acknowledged contribution cancelled"
        description="Label for chatbot’s response to a contribution being cancelled"
        tagName="span"
      />
    ),
  },
  submitted: {
    user: (
      <FormattedMessage
        id="global.userContributionSubmittedNodetitle"
        defaultMessage="End-user submitted contribution"
        description="Label for a contribution that was submitted by the user"
        tagName="span"
      />
    ),
    bot: (
      <FormattedMessage
        id="global.botContributionSubmittedNodetitle"
        defaultMessage="Chatbot acknowledged contribution submitted"
        description="Label for chatbot’s response to a contribution being submitted"
        tagName="span"
      />
    ),
  },
};

const ContributionMessage = ({ message, body, type, origin }: ContributionMessageProps) => {
  return (
    <>
      <NodeContentTitle iconId={origin === 'user' ? 'user' : 'bot'}>
        {CONTRIBUTION_TITLES[type][origin]}
      </NodeContentTitle>
      <div className={styles.nodeContent}>
        <NodeQuote body={body} />
        <dl>
          <TimestampField message={message} />
        </dl>
      </div>
    </>
  );
};

export default ContributionMessage;
