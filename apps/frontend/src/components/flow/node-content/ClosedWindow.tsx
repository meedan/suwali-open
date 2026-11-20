import { FormattedMessage } from "react-intl";

import type { Message } from "@customTypes/message";

import styles from "./NodeContent.module.css";
import NodeContentTitle from "./NodeContentTitle";
import NodeQuote from "./NodeQuote";
import TimestampField from "./TimestampField";

type ClosedWindowProps = {
  message: Message;
  body: Message['body'];
};

const ClosedWindow = ({ message, body }: ClosedWindowProps) => {
  return (
    <>
      <NodeContentTitle iconId="countdown">
        <FormattedMessage
          id="global.closedWindowNodetitle"
          defaultMessage="Conversation window closed"
          description="Label that represents a conversation that has been closed due to inactivity"
          tagName="span"
        />
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

export default ClosedWindow;
