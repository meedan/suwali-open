import clsx from "clsx";
import { useState } from "react";
import { defineMessages, useIntl } from 'react-intl';

import Button from "@ui-components/input/Button";
import TextArea from "@ui-components/input/TextArea";
import Icon from "@ui-components/layout/Icon";

import FeatureFlag from '@components/FeatureFlag';

import styles from "./ConversationInput.module.css";

const messages = defineMessages({
  messagePlaceholder: {
    id: 'conversationInput.messagePlaceholder',
    defaultMessage: 'Type a message…',
    description: 'Type a message…',
  },
  attach: {
    id: 'conversationInput.attach',
    defaultMessage: 'Attach',
    description: 'Button label for attaching a file when writing a new message to the conversation',
  },
  send: {
    id: 'global.send',
    defaultMessage: 'Send',
    description: 'Reusable label for send action',
  }
});

type ConversationInputProps = {
  className?: string;
  focusOnMount?: boolean;
  canSubmit: boolean;
  onSubmit: (message: string) => void;
  submitLabel?: React.ReactNode;
};

const ConversationInput = ({
  className,
  focusOnMount,
  canSubmit,
  onSubmit,
  submitLabel,
}: ConversationInputProps) => {
  const [message, setMessage] = useState("");

  const intl = useIntl();

  return (
    <footer className={clsx(styles.wrapper, className)}>
      <div className={styles.inner}>
        <TextArea
          className={styles.textareaWrapper}
          autoFocus={focusOnMount} // eslint-disable-line jsx-a11y/no-autofocus
          autoGrow
          placeholder={intl.formatMessage(messages.messagePlaceholder)}
          size="large"
          value={message}
          onKeyDown={(e) => {
            if (canSubmit) {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (message.trim()) {
                  onSubmit(message);
                  setMessage("");
                }
              }
            }
          }}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
        />
        <div className={styles.actions}>
          <FeatureFlag flag="CONVERSATION_COMPOSE_ATTACH">
            <Button
              aria-label={intl.formatMessage(messages.attach)}
              iconLeft={<Icon id="paperclip" aria-hidden />}
              size="small"
              themeMode
            />
          </FeatureFlag>
          <div className={styles.mainAction}>
            <Button
              aria-label={intl.formatMessage(messages.send)}
              disabled={!canSubmit}
              iconLeft={submitLabel ? undefined : <Icon id="arrow_up" aria-hidden />}
              label={submitLabel}
              themeMode
              onClick={() => {
                if (message.trim()) {
                  onSubmit(message);
                  setMessage("");
                }
              }}
            />
          </div>
        </div>
      </div>
    </footer>
  )
};

export default ConversationInput;
