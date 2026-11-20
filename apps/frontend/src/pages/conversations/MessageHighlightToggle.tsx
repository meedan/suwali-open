import { defineMessages, useIntl } from 'react-intl';

import type { Message } from '@customTypes/message';

import { useMessageHighlight } from '@contexts/MessageSelectContext';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

const messages = defineMessages({
  selectMessage: {
    id: "global.selectMessage",
    defaultMessage: "Select message",
    description: "Label for button that selects/highlights a message",
  },
  deselectMessage: {
    id: "global.deselectMessage",
    defaultMessage: "Deselect message",
    description: "Label for button that deselects/unhighlights a currently selected message",
  },
});

type MessageHighlightToggleProps = {
  message: Message;
};

const MessageHighlightToggle = ({ message }: MessageHighlightToggleProps) => {
  const intl = useIntl();
  const { highlightMessageId, toggleMessageHighlight } = useMessageHighlight();

  const selected = highlightMessageId === message.id;
  const label = intl.formatMessage(selected ? messages.deselectMessage : messages.selectMessage);

  return (
    <Tooltip content={label}>
      <Button
        aria-label={label}
        aria-pressed={selected}
        active={selected}
        themeMode={!selected}
        variant="filled"
        size="small"
        iconLeft={<Icon id="check" aria-hidden />}
        onClick={() => toggleMessageHighlight(message.id)}
      />
    </Tooltip>
  );
};

export default MessageHighlightToggle;
