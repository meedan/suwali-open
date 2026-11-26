import React, { useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";

import type { Message } from "@customTypes/message";

import { isOlderThanHours } from "@helpers/dates";

import { interactionCallback } from "@services/ConversationsService";

import { useToast } from "@hooks/useToast";

import Button from "@ui-components/input/Button";
import Tooltip from '@ui-components/layout/Tooltip';

import styles from "./InteractiveButtons.module.css";

const messages = defineMessages({
  actionFailed: {
    id: "global.actionFailed",
    defaultMessage: "Action failed",
    description: "Generic short error message displayed when an action fails",
  },
});

const InteractiveButtons = ({ message, fromMe = false }: { message: Message, fromMe: boolean }) => {
  const [clickedButtonIds, setClickedButtonIds] = useState<string[]>([]);

  const intl = useIntl();
  const { toast } = useToast();

  const handleClick = async (
    event: React.MouseEvent<HTMLButtonElement>,
    button: { id: string; text: string; type: string },
  ) => {
    event.stopPropagation();
    setClickedButtonIds((prev: string[]) => {
      return [...prev, button.id];
    });
    try {
      await interactionCallback(message.id, button.id, button.type);
    } catch {
      // Allow trying again if interaction failed
      setClickedButtonIds((prev: string[]) => {
        return prev.filter(id => id !== button.id);
      });
      toast('error', intl.formatMessage(messages.actionFailed));
    }
  };

  const supportedTypes = [
    "cancel_contribution",
    "sources",
    "subscribe",
  ];

  let buttonDisabledReason: React.ReactNode = null;

  const actions = message.interactive_buttons?.map((btn) => {
    if (isOlderThanHours(new Date(message.created_at), 24)) {
      buttonDisabledReason = (
        <FormattedMessage
          id="interactiveButton.messageOlderThan24Hours"
          defaultMessage="Message is older than 24 hours"
          description="Generic short error message displayed when an action is not allowed"
        />
      );
    }

    if (!supportedTypes.includes(btn.type)) {
      buttonDisabledReason = (
        <FormattedMessage
          id="interactiveButton.actionNotSupported"
          defaultMessage="Action not supported on internal platform"
          description="Generic short error message displayed when an action is not supported"
        />
      );
    }

    if (!fromMe) {
      buttonDisabledReason = (
        <FormattedMessage
          id="interactiveButton.actionNotAllowed"
          defaultMessage="Action not allowed"
          description="Generic short error message displayed when an action is not allowed"
        />
      );
    }

    if (clickedButtonIds.includes(btn.id)) {
      buttonDisabledReason = (
        <FormattedMessage
          id="interactiveButton.actionPerformed"
          defaultMessage="Action sent"
          description="Generic short error message displayed when an action is already sent"
        />
      );
    }

    const button = (
      <Button
        className={styles.button}
        key={btn.id}
        disabled={Boolean(buttonDisabledReason)}
        size="small"
        label={btn.text}
        themeMode
        onClick={(event) => handleClick(event, btn)}
      />
    );

    return buttonDisabledReason ? (
      <Tooltip key={btn.id} content={buttonDisabledReason}>
        <div className={styles.disabledButtonTooltipTrigger}>
          {button}
        </div>
      </Tooltip>
    ) : button;
  });

  return (
    <div className={styles.wrapper}>
      {actions}
    </div>
  );
};

export default InteractiveButtons;
