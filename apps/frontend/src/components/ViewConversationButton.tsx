import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";

import type { Conversation, ConversationFrom } from "@customTypes/conversation";

import { useSession } from "@root/SessionContext";

import { useHubPath } from "@hooks/useHubPath";

import Button from "@ui-components/input/Button";

type ViewConversationButtonProps = {
  // Absent while the conversation loads, and the button is left out until it has
  conversation?: Conversation;
  // Opens the conversation scrolled to this message
  messageId?: number;
};

// Takes the reader from a preview of a conversation, or of one of its messages, to the conversation itself
const ViewConversationButton = ({ conversation, messageId }: ViewConversationButtonProps) => {
  const me = useSession().user;
  const navigate = useNavigate();
  const hubPath = useHubPath();

  if (!conversation?.participant) return null;

  const from: ConversationFrom = me?.id === conversation.participant_id
    ? 'me'
    : conversation.participant.type === 'ExternalUser'
      ? 'audience'
      : 'team';

  const query = messageId ? `?messageId=${messageId}` : '';

  return (
    <Button
      label={
        <FormattedMessage
          id="global.messagePanelviewConversation"
          defaultMessage="View full conversation"
          description="Label for button that navigates to a conversation"
        />
      }
      size="small"
      themeMode
      onClick={() => navigate(hubPath(`/conversations/${from}/${conversation.id}${query}`))}
    />
  );
};

export default ViewConversationButton;
