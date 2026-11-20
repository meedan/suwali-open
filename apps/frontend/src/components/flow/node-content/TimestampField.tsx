import { FormattedMessage } from "react-intl";

import type { Message } from "@customTypes/message";

import MessageTimestamp from "@components/MessageTimestamp";

type TimestampFieldProps = {
  message: Message;
};

// A row for the <dl> of metadata in a node popover
const TimestampField = ({ message }: TimestampFieldProps) => (
  <div>
    <FormattedMessage
      id="global.time"
      defaultMessage="Time"
      description="Reusable label for the time of day something happened"
      tagName="dt"
    />
    <dd>
      <MessageTimestamp message={message} />
    </dd>
  </div>
);

export default TimestampField;
