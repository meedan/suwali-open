import { FormattedMessage } from "react-intl";

import type { Message } from "@customTypes/message";

import styles from "./NodeContent.module.css";
import NodeContentTitle from "./NodeContentTitle";
import NodeQuote from "./NodeQuote";
import TimestampField from "./TimestampField";

type RateLimitReachedProps = {
  message: Message;
  body: Message['body'];
};

const RateLimitReached = ({ message, body }: RateLimitReachedProps) => {
  return (
    <>
      <NodeContentTitle iconId="countdown">
        <FormattedMessage
          id="global.rateLimitReachedNodetitle"
          defaultMessage="Rate limit reached"
          description="Label that represents a message that was blocked due to rate limiting"
          tagName="span"
        />
      </NodeContentTitle>
      <div className={styles.nodeContent}>
        <FormattedMessage
          id="global.rateLimitReachedNodedescription"
          defaultMessage="This message was automatically sent because the end-user has reached the conversation rate limit. The end-user must wait for their previous question to be answered before sending another one."
          description="Tooltip that explains that the rate limit was reached and the user must wait"
          tagName="p"
        />
        <br />
        <NodeQuote body={body} />
        <dl>
          <TimestampField message={message} />
        </dl>
      </div>
    </>
  );
};

export default RateLimitReached;
