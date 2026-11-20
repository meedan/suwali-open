import clsx from "clsx";
import { VisuallyHidden } from "radix-ui";
import { defineMessages, useIntl } from "react-intl";

import type { MessageDeliveryError, MessageStatus } from "@customTypes/message";

import Tooltip from "@ui-components/layout/Tooltip";

import styles from "./MessageStatusIndicator.module.css";

type Props = {
  status?: MessageStatus;
  error?: MessageDeliveryError;
};

const statusMessages = defineMessages({
  sent: {
    id: 'global.messageStatus.sent',
    defaultMessage: 'Sent',
    description: 'Delivery status shown for an outgoing message that was successfully sent'
  },
  delivered: {
    id: 'global.messageStatus.delivered',
    defaultMessage: 'Delivered',
    description: 'Delivery status shown for an outgoing message that was delivered'
  },
  failed: {
    id: 'global.messageStatus.failed',
    defaultMessage: 'Failed',
    description: 'Delivery status shown for an outgoing message that failed to send'
  },
});

const failedWithReason = defineMessages({
  label: {
    id: 'global.messageStatus.failedWithReason',
    defaultMessage: 'Failed: {reason}',
    description: 'Delivery status shown for an outgoing message that failed to send, followed by the reason'
  },
});

// Reasons our own backend sets; any other code comes from the platform with its own message
const failureReasons = defineMessages({
  registration_not_approved: {
    id: 'global.messageStatus.failedRegistrationNotApproved',
    defaultMessage: 'the SMS number is not approved for sending yet',
    description: 'Reason an outgoing SMS message was not sent, shown after “Failed:”'
  },
  recipient_opted_out: {
    id: 'global.messageStatus.failedRecipientOptedOut',
    defaultMessage: 'the recipient has opted out of messages',
    description: 'Reason an outgoing message was not sent, shown after “Failed:”'
  },
  rate_limit_cooldown: {
    id: 'global.messageStatus.failedRateLimitCooldown',
    defaultMessage: 'too many messages were sent to this recipient recently',
    description: 'Reason an outgoing WhatsApp message was not sent, shown after “Failed:”'
  },
});

const isKnownReason = (code?: string): code is keyof typeof failureReasons =>
  !!code && Object.prototype.hasOwnProperty.call(failureReasons, code);

const statusSymbol = {
  sent: '\u2714', //Heavy check mark
  delivered: '\u2714\u2714',
  failed: '\u2718', //Heavy ballot x
};

const MessageStatusIndicator = ({ status, error }: Props) => {
  const intl = useIntl();

  if (!status) return null;

  const code = error?.code;
  const reason = isKnownReason(code) ? intl.formatMessage(failureReasons[code]) : (error?.message ?? code);
  const label = status === 'failed' && reason
    ? intl.formatMessage(failedWithReason.label, { reason })
    : intl.formatMessage(statusMessages[status]);

  return (
    <Tooltip content={label}>
      <span
        className={clsx(
          styles.statusIcon,
          {
            [styles.failed]: status === 'failed'
          }
        )}
      >
        <span aria-hidden>{statusSymbol[status]}</span>
        <VisuallyHidden.Root>{label}</VisuallyHidden.Root>
      </span>
    </Tooltip>
  );
};

export default MessageStatusIndicator;
