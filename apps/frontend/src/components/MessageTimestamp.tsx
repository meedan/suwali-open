import { FormattedDate, useIntl } from "react-intl";

import type { Message } from "@customTypes/message";

import Tooltip from "@ui-components/layout/Tooltip";

import MessageStatusIndicator from "@components/MessageStatusIndicator";

import styles from "./MessageTimestamp.module.css";

// A bare timestamp is for things that are not a Message, like cluster replies; it shows no delivery status
type MessageTimestampProps =
  | { message: Message; timestamp?: never }
  | { message?: never; timestamp: string };

const MessageTimestamp = ({ message, timestamp }: MessageTimestampProps) => {
  const intl = useIntl();
  const date = new Date(message ? message.created_at : timestamp);

  return (
    <span className={styles.timestamp}>
      <Tooltip content={intl.formatDate(date, { dateStyle: 'full', timeStyle: 'medium' })}>
        <span>
          <FormattedDate
            value={date}
            hour="2-digit"
            minute="2-digit"
            second="2-digit"
          />
        </span>
      </Tooltip>
      <MessageStatusIndicator
        status={message?.direction === 'outgoing' ? message.status : undefined}
        error={message?.metadata?.delivery_error}
      />
    </span>
  );
};

export default MessageTimestamp;
